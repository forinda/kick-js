/** Where the editor's view roots come from: settings, else kick.config. */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { viewsSetup } from '../src/kick-config'

function app(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kick-ls-roots-')))
  mkdirSync(join(root, 'src/modules/ui/views'), { recursive: true })
  mkdirSync(join(root, 'app/views'), { recursive: true })
  return root
}

describe('viewsSetup', () => {
  it("takes kick.config's views block", () => {
    const root = app()
    const r = viewsSetup(
      root,
      {},
      { views: { dir: 'app/views', roots: { ui: './src/modules/ui/views' } } },
    )
    expect(r).toEqual({
      viewsDir: join(root, 'app/views'),
      roots: [{ name: 'ui', dir: join(root, 'src/modules/ui/views') }],
    })
  })

  it('lets the editor settings win', () => {
    const root = app()
    const r = viewsSetup(
      root,
      { viewsDir: 'src/views', roots: { ui: './src/modules/ui/views' } },
      { views: { dir: 'app/views', roots: { other: './app/views' } } },
    )
    expect(r.viewsDir).toBe(join(root, 'src/views'))
    expect(r.roots.map((x) => x.name)).toEqual(['ui'])
  })

  it('reports a bad root and carries on without roots', () => {
    const root = app()
    const r = viewsSetup(root, {}, { views: { roots: { Bad: './app/views' } } })
    expect(r.roots).toEqual([])
    expect(r.error).toMatch(/Bad/)
  })
})
