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
  it('build fails on a broken template', async () => {
    const root = project({ 'src/views/bad.kick': '{{ a() }}', 'src/views/ok.kick': 'ok' })
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
