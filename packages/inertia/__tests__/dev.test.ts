import 'reflect-metadata'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get } from '@forinda/kickjs'
import { InertiaAdapter, inertia } from '@forinda/kickjs-inertia'

/**
 * Dev mode: `kick dev` puts its Vite server on globalThis. A stand-in with
 * the parts the adapter uses — SSR module loading, the SSR module graph and
 * the HTML transform.
 */
function fakeVite(root: string) {
  const css = {
    url: '/src/client/app.css',
    id: `${root}/src/client/app.css`,
    importedModules: new Set(),
  }
  const page = { url: '/src/client/pages/Home.tsx', id: null, importedModules: new Set([css]) }
  const entry = { url: '/src/client/ssr.tsx', id: null, importedModules: new Set([page, css]) }
  return {
    config: { root },
    environments: {
      ssr: {
        moduleGraph: {
          getModuleById: (id: string) => (id === `${root}/src/client/ssr.tsx` ? entry : undefined),
        },
      },
    },
    loaded: [] as string[],
    async ssrLoadModule(url: string) {
      this.loaded.push(url)
      return {
        default: async (p: { component: string }) => ({
          head: ['<title>SSR</title>'],
          body: `<div data-server-rendered="true" id="app">${p.component}</div>`,
        }),
      }
    },
    ssrFixStacktrace() {},
    async transformIndexHtml(_url: string, html: string) {
      return html.replace('<head>', '<head><script type="module" src="/@vite/client"></script>')
    },
  }
}

describe('InertiaAdapter in dev', () => {
  const g = globalThis as { __kickjs_viteServer?: unknown }
  beforeEach(() => Container.reset())
  afterEach(() => delete g.__kickjs_viteServer)

  it('renders through Vite and links the SSR entry’s stylesheets once', async () => {
    const vite = fakeVite('/app')
    g.__kickjs_viteServer = vite

    @Controller()
    class Pages {
      @Get('/')
      home() {
        return inertia('Home')
      }
    }
    const app = new Application({
      modules: [
        {
          routes: () => ({ path: '/', prefix: false, version: false, controller: Pages }),
        } as never,
      ],
      adapters: [InertiaAdapter({ ssr: { entry: 'src/client/ssr.tsx' } })],
    })
    await app.setup()

    const res = await request(app.handle.bind(app)).get('/').expect(200)
    expect(vite.loaded).toEqual(['/src/client/ssr.tsx'])
    expect(res.text).toContain('<script type="module" src="/@vite/client"></script>')
    expect(res.text).toContain('<script type="module" src="/src/client/main.tsx"></script>')
    expect(res.text.match(/rel="stylesheet"/g)).toHaveLength(1)
    expect(res.text).toContain(
      '<link rel="stylesheet" href="/src/client/app.css" data-vite-dev-id="/app/src/client/app.css" />',
    )
    expect(res.text).toContain('<div data-server-rendered="true" id="app">Home</div>')
    // No build manifest in dev, so no asset version.
    const json = await request(app.handle.bind(app)).get('/').set('X-Inertia', 'true').expect(200)
    expect(json.body.version).toBeNull()
  })
})
