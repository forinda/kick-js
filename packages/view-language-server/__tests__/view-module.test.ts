import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A project dir with `@forinda/kickjs-view` installed as `body`. */
function project(body?: string) {
  const root = mkdtempSync(join(tmpdir(), 'kick-ls-'))
  writeFileSync(join(root, 'package.json'), '{"name":"app","type":"module"}')
  if (body !== undefined) {
    const dir = join(root, 'node_modules/@forinda/kickjs-view')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      // Import-only exports, like the real package: require.resolve can't see it.
      '{"name":"@forinda/kickjs-view","version":"9.9.9","type":"module","exports":{".":{"types":"./index.d.ts","import":"./index.js"}}}',
    )
    writeFileSync(join(dir, 'index.js'), body)
  }
  return root
}

const FULL = `export const marker = 'project'
export const parse = () => {}, check = () => {}, format = () => {}, readPipeExports = () => {}
export const templateName = () => {}, componentTag = () => {}, BUILTIN_PIPES = []`

describe('packageVersion', () => {
  it('reads the version of the package holding an entry file', async () => {
    const { packageVersion } = await import('../src/view-module')
    const root = project(FULL)
    const entry = join(root, 'node_modules/@forinda/kickjs-view/index.js')
    expect(packageVersion(entry)).toBe('9.9.9')
    expect(packageVersion(join(tmpdir(), 'nowhere/index.js'))).toBeUndefined()
  })
})

describe('loadViewModule', () => {
  let load: typeof import('../src/view-module').loadViewModule
  beforeEach(async () => {
    vi.resetModules()
    load = (await import('../src/view-module')).loadViewModule
  })

  it("prefers the project's view package", async () => {
    const warn = vi.fn()
    const got = await load(project(FULL), warn, true)
    expect(got.source).toBe('project')
    expect(got.version).toBe('9.9.9')
    expect((got.view as never as { marker: string }).marker).toBe('project')
    expect(warn).not.toHaveBeenCalled()
  })
  it('warns once on fallback', async () => {
    const warn = vi.fn()
    const got = await load(project(), warn, true)
    expect(got.source).toBe('bundled')
    expect(typeof got.view.parse).toBe('function')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(got.version)
    await load(project(), warn, true)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it('falls back when the project package throws on import', async () => {
    const warn = vi.fn()
    const got = await load(project("throw new Error('boom')"), warn, true)
    expect(got.source).toBe('bundled')
    expect(warn.mock.calls[0]![0]).toContain('boom')
  })
  it('falls back when the project package is too old for the editor', async () => {
    const warn = vi.fn()
    const got = await load(project('export const parse = () => {}'), warn, true)
    expect(got.source).toBe('bundled')
    expect(warn.mock.calls[0]![0]).toContain('9.9.9')
  })
  it("never runs an untrusted workspace's code", async () => {
    const warn = vi.fn()
    const root = project('globalThis.__ran = true\n' + FULL)
    const got = await load(root, warn, false)
    expect(got.source).toBe('bundled')
    expect((globalThis as { __ran?: boolean }).__ran).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
  it('follows nested conditions in the exports map', async () => {
    const root = project("throw new Error('wrong entry')")
    const dir = join(root, 'node_modules/@forinda/kickjs-view')
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist/main.js'), FULL)
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"@forinda/kickjs-view","version":"9.9.9","type":"module","exports":{".":{"import":{"types":"./dist/main.d.ts","default":"./dist/main.js"}}}}',
    )
    expect((await load(root, vi.fn(), true)).source).toBe('project')
  })
  it('takes conditions in the order the package declares them, as Node does', async () => {
    const root = project(FULL)
    const dir = join(root, 'node_modules/@forinda/kickjs-view')
    writeFileSync(join(dir, 'node.js'), "throw new Error('node entry')")
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"@forinda/kickjs-view","version":"9.9.9","type":"module","exports":{".":{"types":"./index.d.ts","import":"./index.js","node":"./node.js"}}}',
    )
    expect((await load(root, vi.fn(), true)).source).toBe('project')
  })
  it('refuses an entry outside the package folder', async () => {
    const root = project(FULL)
    const pkg = join(root, 'node_modules/@forinda/kickjs-view/package.json')
    writeFileSync(join(root, 'evil.js'), FULL)
    writeFileSync(
      pkg,
      '{"name":"@forinda/kickjs-view","version":"9.9.9","exports":{".":{"import":"../../../evil.js"}}}',
    )
    expect((await load(root, vi.fn(), true)).source).toBe('bundled')
  })
})
