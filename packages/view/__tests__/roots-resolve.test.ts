/** kick.config's `views` block → the folders every tool reads. */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveViewRoots, rootFolders } from '../src/roots'

function app(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kick-roots-')))
  mkdirSync(join(root, 'src/views'), { recursive: true })
  return root
}
function pkg(dir: string, kick?: object): void {
  mkdirSync(join(dir, 'views'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', ...(kick ? { kick } : {}) }))
}

describe('resolveViewRoots', () => {
  it('defaults the app folder to src/views', () => {
    const root = app()
    expect(resolveViewRoots(root)).toEqual({ dir: join(root, 'src/views'), roots: [] })
  })

  it('resolves folder roots from the project', () => {
    const root = app()
    mkdirSync(join(root, 'src/modules/billing/views'), { recursive: true })
    mkdirSync(join(root, 'shared'), { recursive: true })
    const r = resolveViewRoots(root, {
      roots: { billing: './src/modules/billing/views', shared: 'shared' },
    })
    expect(r.roots).toEqual([
      { name: 'billing', dir: join(root, 'src/modules/billing/views'), readOnly: false },
      { name: 'shared', dir: join(root, 'shared'), readOnly: false },
    ])
    expect(rootFolders(r.roots)).toEqual({
      billing: join(root, 'src/modules/billing/views'),
      shared: join(root, 'shared'),
    })
  })

  it("reads an installed package's views folder from its package.json", () => {
    const root = app()
    pkg(join(root, 'node_modules/@acme/ui'), { views: 'views' })
    expect(resolveViewRoots(root, { roots: { ui: '@acme/ui' } }).roots).toEqual([
      { name: 'ui', dir: join(root, 'node_modules/@acme/ui/views'), readOnly: true },
    ])
  })

  it('treats a symlinked workspace package as editable', () => {
    const root = app()
    pkg(join(root, 'packages/ui'), { views: 'views' })
    mkdirSync(join(root, 'node_modules/@acme'), { recursive: true })
    symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/@acme/ui'))
    expect(resolveViewRoots(root, { roots: { ui: '@acme/ui' } }).roots[0]).toMatchObject({
      readOnly: false,
    })
  })

  it("refuses a package that doesn't say where its views are", () => {
    const root = app()
    pkg(join(root, 'node_modules/@acme/ui'))
    expect(() => resolveViewRoots(root, { roots: { ui: '@acme/ui' } })).toThrow(
      /@acme\/ui.*kick\.views/,
    )
  })

  it('refuses a bad root name or a missing folder, naming the root', () => {
    const root = app()
    expect(() => resolveViewRoots(root, { roots: { Bad: './src/views' } })).toThrow(/Bad/)
    expect(() => resolveViewRoots(root, { roots: { gone: './nowhere' } })).toThrow(/gone/)
  })
})
