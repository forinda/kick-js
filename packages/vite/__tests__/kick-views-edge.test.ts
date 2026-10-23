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
import { clientScriptResponse, createViews } from '@forinda/kickjs-view'
const views = createViews({
  ...kickViews,
  layout: 'layouts/main',
  // A built bundle carries plain JS: nothing should strip on the edge.
  stripTypes: () => { throw new Error('should not strip') },
})
export default {
  async fetch(request) {
    const script = await clientScriptResponse(views, request)
    if (script) return script
    const url = new URL(request.url)
    const page = url.pathname === '/island' ? 'island' : 'home'
    const html = await views.render(page, { name: url.searchParams.get('name') })
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
      'src/views/components/flash-toast.kick':
        "<kick-toast>hi</kick-toast>\n<script client>\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n</script>",
      'src/views/island.kick': '<flash-toast /><import-box /><import-two />',
      // Two importers: the helper becomes a shared chunk.
      'src/views/components/import-box.kick':
        "<div></div>\n<script client>\nimport { label } from './label'\nconsole.log(label)\n</script>",
      'src/views/components/import-two.kick':
        "<div></div>\n<script client>\nimport { label } from './label'\nconsole.log(label, 2)\n</script>",
      'src/views/components/label.ts': "export let label: string = 'from a chunk'\nlabel += '!'",
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
      const island = await (await mf.dispatchFetch('http://edge/island')).text()
      const src = /src="([^"]+)"/.exec(island)![1]!
      const js = await mf.dispatchFetch(`http://edge${src}`)
      expect(js.status).toBe(200)
      // The importing component's entry, then the module it imports.
      const entry = /src="(\/_kick\/c\/import-box\.[^"]+)"/.exec(island)![1]!
      const entryJs = await (await mf.dispatchFetch(`http://edge${entry}`)).text()
      const dep = /from\s*["']\.\/([^"']+)["']|import\s*["']\.\/([^"']+)["']/.exec(entryJs)
      expect(dep).toBeTruthy()
      const depJs = await mf.dispatchFetch(`http://edge/_kick/c/${dep![1] ?? dep![2]}`)
      expect(depJs.status).toBe(200)
      expect(await depJs.text()).toContain('from a chunk')
      expect(await js.text()).toMatch(/customElements\.define\(["'`]kick-toast/)
    } finally {
      await mf.dispose()
    }
  }, 60_000)
})
