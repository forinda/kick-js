/**
 * Asset manager runtime tests (assets-plan.md PR 3).
 *
 * Covers all three accessor variants (Proxy, hook, string), the
 * three resolution modes (env override, built manifest, dev
 * fallback), and the error surface (UnknownAssetError).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ASSET_MANIFEST_VERSION,
  ASSETS,
  UnknownAssetError,
  assets,
  clearAssetCache,
  resolveAsset,
  useAssets,
} from '../src'

let cwd: string
let originalCwd: string
let originalEnvRoot: string | undefined

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-assets-runtime-'))
  originalCwd = process.cwd()
  originalEnvRoot = process.env.KICK_ASSETS_ROOT
  process.chdir(cwd)
  clearAssetCache()
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalEnvRoot === undefined) {
    delete process.env.KICK_ASSETS_ROOT
  } else {
    process.env.KICK_ASSETS_ROOT = originalEnvRoot
  }
  clearAssetCache()
  try {
    rmSync(cwd, { recursive: true, force: true })
  } catch {
    /* ignore cleanup races */
  }
})

function writeFile(rel: string, content = ''): void {
  const full = join(cwd, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function writeManifest(dir: string, entries: Record<string, string>): void {
  mkdirSync(join(cwd, dir), { recursive: true })
  writeFileSync(
    join(cwd, dir, '.kickjs-assets.json'),
    JSON.stringify({ version: ASSET_MANIFEST_VERSION, entries }, null, 2),
  )
}

describe('resolveAsset — built manifest path (prod)', () => {
  it('reads the manifest from dist/ + returns absolute paths', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs', 'hi')
    const path = resolveAsset('mails', 'welcome')
    expect(path).toBe(join(cwd, 'dist/mails/welcome.ejs'))
  })

  it('honours absolute manifest entries verbatim', () => {
    const abs = join(cwd, 'somewhere/else/file.txt')
    writeFile('somewhere/else/file.txt')
    writeManifest('dist', { 'x/y': abs })
    expect(resolveAsset('x', 'y')).toBe(abs)
  })

  it('also probes build/ + out/ for the manifest', () => {
    writeManifest('out', { 'reports/monthly': 'reports/monthly.ejs' })
    writeFile('out/reports/monthly.ejs')
    expect(resolveAsset('reports', 'monthly')).toBe(join(cwd, 'out/reports/monthly.ejs'))
  })

  it('skips a future-version manifest + falls through', () => {
    mkdirSync(join(cwd, 'dist'), { recursive: true })
    writeFileSync(
      join(cwd, 'dist/.kickjs-assets.json'),
      JSON.stringify({ version: 99, entries: { 'x/y': 'whatever' } }),
    )
    expect(() => resolveAsset('x', 'y')).toThrow(UnknownAssetError)
  })
})

describe('resolveAsset — KICK_ASSETS_ROOT env override', () => {
  it('reads the manifest from the env-pointed directory', () => {
    writeManifest('custom', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('custom/mails/welcome.ejs')
    process.env.KICK_ASSETS_ROOT = join(cwd, 'custom')
    clearAssetCache()
    expect(resolveAsset('mails', 'welcome')).toBe(join(cwd, 'custom/mails/welcome.ejs'))
  })

  it('falls back to dist when the env path has no manifest', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    process.env.KICK_ASSETS_ROOT = join(cwd, 'nonexistent')
    clearAssetCache()
    expect(resolveAsset('mails', 'welcome')).toBe(join(cwd, 'dist/mails/welcome.ejs'))
  })
})

describe('resolveAsset — dev fallback (no manifest)', () => {
  it('synthesises from kick.config.json + walks the src tree', () => {
    writeFile(
      'kick.config.json',
      JSON.stringify({ assetMap: { mails: { src: 'src/templates/mails' } } }),
    )
    writeFile('src/templates/mails/welcome.ejs', 'hi')
    writeFile('src/templates/mails/orders/confirmation.ejs', 'order')

    expect(resolveAsset('mails', 'welcome')).toBe(join(cwd, 'src/templates/mails/welcome.ejs'))
    expect(resolveAsset('mails', 'orders/confirmation')).toBe(
      join(cwd, 'src/templates/mails/orders/confirmation.ejs'),
    )
  })

  it('honours an extension-glob filter', () => {
    writeFile(
      'kick.config.json',
      JSON.stringify({
        assetMap: { x: { src: 'src/x', glob: '**/*.ejs' } },
      }),
    )
    writeFile('src/x/keep.ejs', 'keep')
    writeFile('src/x/skip.txt', 'skip')

    expect(resolveAsset('x', 'keep')).toBe(join(cwd, 'src/x/keep.ejs'))
    expect(() => resolveAsset('x', 'skip')).toThrow(UnknownAssetError)
  })

  it('honours a brace-expansion glob filter', () => {
    writeFile(
      'kick.config.json',
      JSON.stringify({
        assetMap: { x: { src: 'src/x', glob: '**/*.{ejs,html}' } },
      }),
    )
    writeFile('src/x/a.ejs')
    writeFile('src/x/b.html')
    writeFile('src/x/c.txt')

    expect(() => resolveAsset('x', 'a')).not.toThrow()
    expect(() => resolveAsset('x', 'b')).not.toThrow()
    expect(() => resolveAsset('x', 'c')).toThrow(UnknownAssetError)
  })

  it('returns UnknownAssetError when no kick.config exists', () => {
    expect(() => resolveAsset('mails', 'welcome')).toThrow(UnknownAssetError)
  })
})

describe('resolveAsset — error surface', () => {
  it('throws UnknownAssetError carrying namespace + key fields', () => {
    writeManifest('dist', { 'x/y': 'x/y.txt' })
    writeFile('dist/x/y.txt')
    try {
      resolveAsset('x', 'missing')
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAssetError)
      expect((err as UnknownAssetError).namespace).toBe('x')
      expect((err as UnknownAssetError).key).toBe('missing')
      return
    }
    throw new Error('expected throw')
  })
})

describe('Variant A — assets Proxy ambient', () => {
  it('resolves single-level access (assets.mails.welcome())', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    // Proxy returns a callable; the typegen-emitted KickAssets type
    // would narrow this in real adopter code, but at runtime the
    // shape works without it.
    const path = (assets as any).mails.welcome()
    expect(path).toBe(join(cwd, 'dist/mails/welcome.ejs'))
  })

  it('resolves nested access (assets.mails.orders.confirmation())', () => {
    writeManifest('dist', { 'mails/orders/confirmation': 'mails/orders/confirmation.ejs' })
    writeFile('dist/mails/orders/confirmation.ejs')
    const path = (assets as any).mails.orders.confirmation()
    expect(path).toBe(join(cwd, 'dist/mails/orders/confirmation.ejs'))
  })

  it('returns undefined for reserved Proxy keys (then, toString, etc.)', () => {
    expect((assets as any).then).toBeUndefined()
    expect((assets as any).toString).toBeUndefined()
    expect((assets as any).asymmetricMatch).toBeUndefined()
  })

  it('supports computed namespace lookups via bracket access', () => {
    writeManifest('dist', { 'reports/monthly': 'reports/monthly.ejs' })
    writeFile('dist/reports/monthly.ejs')
    const ns = 'reports'
    const key = 'monthly'
    const path = (assets as any)[ns][key]()
    expect(path).toBe(join(cwd, 'dist/reports/monthly.ejs'))
  })
})

describe('Variant B — useAssets hook', () => {
  it('returns the same Proxy as the ambient export', () => {
    expect(useAssets()).toBe(assets)
  })

  it('works as a class field for DI-style consumption', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    class MailService {
      private readonly assetsRef = useAssets()
      welcome(): string {
        return (this.assetsRef as any).mails.welcome()
      }
    }
    expect(new MailService().welcome()).toBe(join(cwd, 'dist/mails/welcome.ejs'))
  })
})

describe('ASSETS DI token', () => {
  it('uses the kick/assets/Map convention name', () => {
    expect(ASSETS.name).toBe('kick/assets/Map')
  })
})

describe('clearAssetCache — manifest swap', () => {
  it('observes manifest changes after a clear', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    expect(resolveAsset('mails', 'welcome')).toContain('mails/welcome.ejs')

    cpSync(join(cwd, 'dist/mails/welcome.ejs'), join(cwd, 'dist/mails/welcome2.ejs'))
    writeManifest('dist', { 'mails/welcome2': 'mails/welcome2.ejs' })

    // Without clear, the cache still holds the old manifest.
    expect(() => resolveAsset('mails', 'welcome2')).toThrow(UnknownAssetError)

    clearAssetCache()
    expect(resolveAsset('mails', 'welcome2')).toContain('mails/welcome2.ejs')
  })
})
