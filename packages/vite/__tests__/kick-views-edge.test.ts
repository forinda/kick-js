/**
 * `.kick` pages on the edge: a worker built with the plugin renders from the
 * bundled templates in workerd (miniflare), with no file system.
 */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'
import { Miniflare } from 'miniflare'
import { describe, expect, it } from 'vitest'
import { kickViewsPlugin } from '../src/kick-views-plugin'

// The temp project sits outside the workspace: link the built package into
// its node_modules, so its exports and their conditions resolve as installed.
const VIEW_PKG = dirname(dirname(fileURLToPath(import.meta.resolve('@forinda/kickjs-view'))))

const WORKER = `
import kickViews from 'virtual:kick-views'
import { createViews } from '@forinda/kickjs-view'
const views = createViews({ ...kickViews, layout: 'layouts/main' })
export default {
  async fetch(request) {
    const html = await views.render('home', { name: new URL(request.url).searchParams.get('name') })
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
}
`

describe('kick views on workerd', () => {
  it('renders from the bundle, with no node:fs in the worker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kick-views-edge-'))
    const files: Record<string, string> = {
      'worker.js': WORKER,
      'src/views/home.kick': '<h1>Hi {{ name | shout }}</h1>',
      'src/views/layouts/main.kick': '<main><slot /></main>',
      'src/views/pipes.ts': 'export const shout = (v: string) => `${v}!`',
    }
    mkdirSync(join(root, 'node_modules/@forinda'), { recursive: true })
    symlinkSync(VIEW_PKG, join(root, 'node_modules/@forinda/kickjs-view'), 'dir')
    for (const [name, src] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), src)
    }
    const out = (await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [kickViewsPlugin()],
      resolve: {
        conditions: ['workerd', 'worker', 'import', 'default'],
      },
      ssr: { noExternal: true, target: 'webworker' },
      build: {
        ssr: join(root, 'worker.js'),
        write: false,
        minify: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const chunks = (Array.isArray(out) ? out[0]! : out).output
    const script = chunks.map((c) => ('code' in c ? c.code : '')).join('\n')
    expect(script).not.toMatch(/node:fs/)

    const mf = new Miniflare({ modules: true, script, compatibilityDate: '2025-01-01' })
    try {
      const res = await mf.dispatchFetch('http://edge/?name=<Ada>')
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('<main><h1>Hi &lt;Ada&gt;!</h1></main>')
    } finally {
      await mf.dispose()
    }
  }, 60_000)
})
