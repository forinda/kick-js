/**
 * Unit tests for the typegen asset discovery + ambient-augmentation
 * renderer (assets-plan.md PR 4).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverAssets, renderAssetTypes } from '../src/typegen/asset-types'
import type { AssetMapEntry } from '../src/config'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-asset-types-'))
})

afterEach(() => {
  try {
    rmSync(cwd, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function writeFile(rel: string, content = ''): void {
  const full = join(cwd, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('discoverAssets', () => {
  it('returns empty when no assetMap is given', () => {
    const out = discoverAssets(undefined, cwd)
    expect(out).toEqual({ entries: [], count: 0 })
  })

  it('walks each entry src + strips extensions', () => {
    writeFile('src/templates/mails/welcome.ejs')
    writeFile('src/templates/mails/password-reset.ejs')
    writeFile('src/templates/mails/orders/confirmation.ejs')

    const map: Record<string, AssetMapEntry> = {
      mails: { src: 'src/templates/mails' },
    }
    const out = discoverAssets(map, cwd)
    expect(out.count).toBe(3)
    expect(out.entries.map((e) => `${e.namespace}/${e.key}`).sort()).toEqual([
      'mails/orders/confirmation',
      'mails/password-reset',
      'mails/welcome',
    ])
  })

  it('honours an extension glob filter', () => {
    writeFile('src/x/keep.ejs')
    writeFile('src/x/another.html')
    writeFile('src/x/exclude.txt')

    const map: Record<string, AssetMapEntry> = {
      x: { src: 'src/x', glob: '**/*.{ejs,html}' },
    }
    const out = discoverAssets(map, cwd)
    expect(out.entries.map((e) => e.key).sort()).toEqual(['another', 'keep'])
    expect(out.count).toBe(2)
  })

  it('dedupes when two files in same dir flatten to the same key', () => {
    writeFile('src/x/index.html')
    writeFile('src/x/index.js')

    const map: Record<string, AssetMapEntry> = { x: { src: 'src/x' } }
    const out = discoverAssets(map, cwd)
    // Both files map to logical key `x/index` — dedupe to one entry.
    expect(out.count).toBe(1)
    expect(out.entries[0]).toEqual({ namespace: 'x', key: 'index' })
  })

  it('returns 0 for entries pointing at missing directories', () => {
    const map: Record<string, AssetMapEntry> = {
      ghost: { src: 'src/missing' },
    }
    expect(discoverAssets(map, cwd).count).toBe(0)
  })

  it('skips entries with non-string src', () => {
    const map = {
      bad: {} as AssetMapEntry,
    }
    expect(discoverAssets(map, cwd).count).toBe(0)
  })

  it('combines multiple namespaces', () => {
    writeFile('src/mails/welcome.ejs')
    writeFile('src/reports/monthly.ejs')

    const map: Record<string, AssetMapEntry> = {
      mails: { src: 'src/mails' },
      reports: { src: 'src/reports' },
    }
    const out = discoverAssets(map, cwd)
    expect(out.count).toBe(2)
  })
})

describe('renderAssetTypes', () => {
  it('emits an empty interface when no entries are discovered', () => {
    const dts = renderAssetTypes({ entries: [], count: 0 })
    expect(dts).toContain("declare module '@forinda/kickjs'")
    expect(dts).toContain('interface KickAssets {}')
    expect(dts).toContain('No assetMap entries')
  })

  it('emits a flat namespace tree for top-level files', () => {
    const dts = renderAssetTypes({
      entries: [
        { namespace: 'mails', key: 'welcome' },
        { namespace: 'mails', key: 'password-reset' },
      ],
      count: 2,
    })
    expect(dts).toContain('interface KickAssets {')
    expect(dts).toContain('mails: {')
    expect(dts).toContain('welcome: () => string')
    // Non-identifier keys quoted
    expect(dts).toContain('"password-reset": () => string')
  })

  it('nests directory paths into nested object types', () => {
    const dts = renderAssetTypes({
      entries: [
        { namespace: 'mails', key: 'welcome' },
        { namespace: 'mails', key: 'orders/confirmation' },
        { namespace: 'mails', key: 'orders/shipped' },
      ],
      count: 3,
    })
    expect(dts).toMatch(/mails:\s*\{/)
    expect(dts).toMatch(/orders:\s*\{/)
    expect(dts).toContain('confirmation: () => string')
    expect(dts).toContain('shipped: () => string')
    expect(dts).toContain('welcome: () => string')
  })

  it('puts multiple namespaces side by side', () => {
    const dts = renderAssetTypes({
      entries: [
        { namespace: 'mails', key: 'welcome' },
        { namespace: 'reports', key: 'monthly' },
      ],
      count: 2,
    })
    expect(dts).toContain('mails: {')
    expect(dts).toContain('reports: {')
    expect(dts).toContain('monthly: () => string')
  })

  it('preserves non-identifier characters via JSON.stringify quoting', () => {
    const dts = renderAssetTypes({
      entries: [
        { namespace: 'mails', key: 'with space' },
        { namespace: 'mails', key: '123-numeric' },
        { namespace: 'mails', key: 'plain_ok' },
      ],
      count: 3,
    })
    expect(dts).toContain('"with space": () => string')
    expect(dts).toContain('"123-numeric": () => string')
    // Plain identifier — no quotes
    expect(dts).toMatch(/\bplain_ok: \(\) => string/)
  })

  it('resolves file-vs-directory leaf collisions in favour of the directory', () => {
    // mails/welcome.ejs → key 'welcome'
    // mails/welcome/login.ejs → key 'welcome/login' (after stripping
    //   the ext from the leaf, the intermediate 'welcome' becomes a dir)
    // The renderer should promote 'welcome' to a sub-object containing
    // 'login', dropping the original leaf.
    const dts = renderAssetTypes({
      entries: [
        { namespace: 'mails', key: 'welcome' },
        { namespace: 'mails', key: 'welcome/login' },
      ],
      count: 2,
    })
    expect(dts).toMatch(/welcome:\s*\{/)
    expect(dts).toContain('login: () => string')
    // The bare `welcome: () => string` shouldn't appear at the top
    // level of the mails block — it lost to the subtree.
    expect(dts).not.toMatch(/welcome:\s*\(\) => string/)
  })
})
