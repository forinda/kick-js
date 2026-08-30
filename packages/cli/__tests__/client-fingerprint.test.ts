import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint } from '../src/typegen/client/fingerprint'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kick-fp-'))
  const src = join(dir, 'a.ts')
  writeFileSync(src, 'export const a = 1')
  return {
    dir,
    src,
    hash: () =>
      fingerprint({
        projectDir: dir,
        fileNames: [src],
        keys: [],
        options: {},
        cliVersion: '1.0.0',
      }),
  }
}

describe('client map fingerprint', () => {
  it('is stable when nothing changes', () => {
    const p = project()
    expect(p.hash()).toBe(p.hash())
  })

  it('changes when a source file changes', () => {
    const p = project()
    const before = p.hash()
    writeFileSync(p.src, 'export const a = 2')
    expect(p.hash()).not.toBe(before)
  })

  // mtime alone must not invalidate: a rebuild that rewrites identical bytes
  // is exactly the case this cache exists to skip.
  it('ignores mtime when content is identical', () => {
    const p = project()
    const before = p.hash()
    writeFileSync(p.src, 'export const a = 1')
    expect(p.hash()).toBe(before)
  })

  it('changes when the CLI version changes', () => {
    const p = project()
    const other = fingerprint({
      projectDir: p.dir,
      fileNames: [p.src],
      keys: [],
      options: {},
      cliVersion: '2.0.0',
    })
    expect(other).not.toBe(p.hash())
  })

  it('changes when compiler options change', () => {
    const p = project()
    const other = fingerprint({
      projectDir: p.dir,
      fileNames: [p.src],
      keys: [],
      options: { strict: true },
      cliVersion: '1.0.0',
    })
    expect(other).not.toBe(p.hash())
  })

  // node_modules is not hashed (too big); the lockfile stands in for it.
  it('tracks dependency changes through the lockfile', () => {
    const p = project()
    writeFileSync(join(p.dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
    const before = p.hash()
    writeFileSync(join(p.dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages: {}')
    expect(p.hash()).not.toBe(before)
  })

  it('does not hash node_modules contents', () => {
    const p = project()
    const nm = join(p.dir, 'node_modules', 'dep')
    mkdirSync(nm, { recursive: true })
    const dep = join(nm, 'index.d.ts')
    writeFileSync(dep, 'export const v = 1')
    const opts = {
      projectDir: p.dir,
      fileNames: [p.src, dep],
      keys: [],
      options: {},
      cliVersion: '1.0.0',
    }
    const before = fingerprint(opts)
    writeFileSync(dep, 'export const v = 2')
    expect(fingerprint(opts)).toBe(before)
  })

  // A route can move without any hashed file moving: the scan root is
  // configurable and need not sit inside the tsconfig program.
  it('changes when the route keys change', () => {
    const p = project()
    const base = { projectDir: p.dir, fileNames: [p.src], options: {}, cliVersion: '1.0.0' }
    expect(fingerprint({ ...base, keys: ['GET /a'] })).not.toBe(
      fingerprint({ ...base, keys: ['GET /b'] }),
    )
  })

  // The scaffolded tsconfig includes `.kickjs/types/**\/*.d.ts`, which is where
  // this map itself is written. Hashing it would make the fingerprint depend on
  // the previous run's output, so it could never match twice.
  it('does not hash typegen output under .kickjs', () => {
    const p = project()
    const gen = join(p.dir, '.kickjs', 'types')
    mkdirSync(gen, { recursive: true })
    const out = join(gen, 'kick__client.d.ts')
    writeFileSync(out, 'declare const a: 1')
    const opts = {
      projectDir: p.dir,
      fileNames: [p.src, out],
      keys: [],
      options: {},
      cliVersion: '1.0.0',
    }
    const before = fingerprint(opts)
    writeFileSync(out, 'declare const a: 2')
    expect(fingerprint(opts)).toBe(before)
  })

  // A stable "unreadable" marker would hash the same every run, so a later
  // dependency change would still match the stamp and skip.
  it('throws rather than hashing a marker for an unreadable file', () => {
    const p = project()
    const gone = join(p.dir, 'nope.ts')
    expect(() =>
      fingerprint({
        projectDir: p.dir,
        fileNames: [gone],
        keys: [],
        options: {},
        cliVersion: '1.0.0',
      }),
    ).toThrow(/cannot read project file/)
  })

  it('is order-independent', () => {
    const p = project()
    const b = join(p.dir, 'b.ts')
    writeFileSync(b, 'export const b = 1')
    const base = { projectDir: p.dir, keys: [], options: {}, cliVersion: '1.0.0' }
    expect(fingerprint({ ...base, fileNames: [p.src, b] })).toBe(
      fingerprint({ ...base, fileNames: [b, p.src] }),
    )
  })
})

describe('client map fingerprint — expansion depth', () => {
  // The depth changes what is emitted, so a project that raises it must get a
  // rebuilt map rather than the cached one.
  it('changes when maxDepth changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-fp-depth-'))
    const src = join(dir, 'a.ts')
    writeFileSync(src, 'export const a = 1')
    const base = { projectDir: dir, fileNames: [src], keys: [], cliVersion: '1.0.0' }
    expect(fingerprint({ ...base, options: { __kickMaxDepth: 12 } })).not.toBe(
      fingerprint({ ...base, options: { __kickMaxDepth: 24 } }),
    )
  })
})
