import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, createServer, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import { kickViewsPlugin } from '../src/kick-views-plugin'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-views-build-'))
  const all = { 'entry.ts': "export { default } from 'virtual:kick-views'", ...files }
  for (const [name, src] of Object.entries(all)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), src)
  }
  return root
}

async function bundle(root: string): Promise<string> {
  const out = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [kickViewsPlugin()],
    build: { ssr: join(root, 'entry.ts'), write: false, minify: false },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[]
  const output = (Array.isArray(out) ? out[0]! : out).output
  return output.map((c) => ('code' in c ? c.code : '')).join('\n')
}

describe('kickViewsPlugin', () => {
  it('bundles imports into shared chunks', async () => {
    const comp = (tag: string) =>
      `<div></div>\n<script client>\nimport { count } from './shared'\nconst n: number = count\ncustomElements.define('${tag}-el', class extends HTMLElement {})\nconsole.log(n)\n</script>`
    const code = await bundle(
      project({
        'src/views/components/toast-a.kick': comp('toast-a'),
        'src/views/components/toast-b.kick': comp('toast-b'),
        'src/views/components/shared.ts': 'export let count = 41\ncount++\n',
        'src/views/home.kick': '<toast-a /><toast-b />',
      }),
    )
    const a = /"toast-a": ?"(toast-a\.[A-Za-z0-9_-]{8}\.js)"/.exec(code)
    const b = /"toast-b": ?"(toast-b\.[A-Za-z0-9_-]{8}\.js)"/.exec(code)
    expect(a && b).toBeTruthy()
    // One shared chunk holds the helper; both entries import it.
    const chunk = /"(shared\.[A-Za-z0-9_-]{8}\.js)":/.exec(code)
    expect(chunk).toBeTruthy()
    expect(code.split(chunk![1]!).length - 1).toBeGreaterThanOrEqual(3)
    expect(code).not.toContain(': number')
  })

  it('build ships plain JavaScript', async () => {
    const code = await bundle(
      project({
        'src/views/components/flash-toast.kick':
          "<kick-toast>hi</kick-toast>\n<script client>\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n</script>",
        'src/views/home.kick': '<flash-toast />',
      }),
    )
    expect(code).toMatch(/"js": ?true/)
    expect(code).toContain('customElements.define(')
    expect(code).toContain('kick-toast')
    expect(code).not.toContain(': number')
  })

  it('build fails on a broken template', async () => {
    const root = project({ 'src/views/bad.kick': '{{ a() }}', 'src/views/ok.kick': 'ok' })
    await expect(bundle(root)).rejects.toThrow(/bad\.kick:1:\d+.*calls aren't allowed/s)
  })

  it('build fails on a broken template even when nothing imports the virtual module', async () => {
    const root = project({ 'src/views/bad.kick': '{{ a() }}' })
    writeFileSync(join(root, 'entry.ts'), 'export const x = 1')
    await expect(bundle(root)).rejects.toThrow(/bad\.kick:1:\d+.*calls aren't allowed/s)
  })

  it('emits data, not code', async () => {
    const root = project({
      'src/views/home.kick': "@layout('layouts/main')\n<h1>{{ t | initials }}</h1>",
      'src/views/layouts/main.kick': '<main><slot /></main>',
      'src/views/pipes.ts': 'export const initials = (v: string) => v[0]',
    })
    const code = await bundle(root)
    expect(code).toContain('"v": 1')
    expect(code).toContain('"layouts/main"')
    expect(code).toMatch(/initials/)
    // the template body is data: no functions generated from it
    const data = code.slice(
      code.indexOf('const bundle'),
      code.indexOf('};', code.indexOf('const bundle')),
    )
    expect(data).not.toMatch(/function|=>/)
  })

  it('an unknown pipe fails the build', async () => {
    const root = project({ 'src/views/p.kick': '{{ x | nope }}' })
    await expect(bundle(root)).rejects.toThrow(/unknown pipe 'nope'/)
  })

  it('dev serves no bundle: the file loader reads templates', async () => {
    const root = project({ 'src/views/home.kick': 'x' })
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [kickViewsPlugin()],
      server: { middlewareMode: true, ws: false },
    })
    try {
      const mod = (await server.ssrLoadModule('/entry.ts')) as {
        default: { bundle: unknown; pipes: object }
      }
      expect(mod.default.bundle).toBeNull()
      expect(mod.default.pipes).toEqual({})
    } finally {
      await server.close()
    }
  })
})
