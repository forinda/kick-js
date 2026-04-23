/**
 * Unit tests for `buildAssets` (asset-manager PR 2).
 *
 * Each test creates a tmp project (src dir tree + kick.config-shaped
 * object) and asserts the resulting `dist/` layout + manifest. No
 * vite, no Express — just the asset-manager pipeline in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAssets, readAssetManifest, ASSET_MANIFEST_VERSION } from '../src/asset-manager/build'
import type { KickConfig } from '../src/config'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-asset-build-'))
})

afterEach(() => {
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

describe('buildAssets — happy path', () => {
  it('copies every src file into dist/<namespace>/ + writes the manifest', async () => {
    writeFile('src/templates/mails/welcome.ejs', '<h1>hi</h1>')
    writeFile('src/templates/mails/password-reset.ejs', '<p>reset</p>')
    writeFile('src/templates/mails/orders/confirmation.ejs', '<p>order</p>')

    const config: KickConfig = {
      assetMap: {
        mails: { src: 'src/templates/mails' },
      },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(result).not.toBeNull()
    expect(result!.entries).toHaveLength(1)
    expect(result!.entries[0].filesCopied).toBe(3)

    expect(existsSync(join(cwd, 'dist/mails/welcome.ejs'))).toBe(true)
    expect(existsSync(join(cwd, 'dist/mails/orders/confirmation.ejs'))).toBe(true)

    const manifest = result!.manifest
    expect(manifest.version).toBe(ASSET_MANIFEST_VERSION)
    expect(manifest.entries['mails/welcome']).toBe('mails/welcome.ejs')
    expect(manifest.entries['mails/password-reset']).toBe('mails/password-reset.ejs')
    expect(manifest.entries['mails/orders/confirmation']).toBe('mails/orders/confirmation.ejs')
  })

  it('respects the glob filter', async () => {
    writeFile('src/templates/mails/welcome.ejs')
    writeFile('src/templates/mails/welcome.html')
    writeFile('src/templates/mails/notes.txt') // excluded

    const config: KickConfig = {
      assetMap: {
        mails: { src: 'src/templates/mails', glob: '**/*.{ejs,html}' },
      },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(result!.entries[0].filesCopied).toBe(2)
    expect(existsSync(join(cwd, 'dist/mails/notes.txt'))).toBe(false)
    expect(existsSync(join(cwd, 'dist/mails/welcome.ejs'))).toBe(true)
    expect(existsSync(join(cwd, 'dist/mails/welcome.html'))).toBe(true)
  })

  it('honours a custom dest directory', async () => {
    writeFile('src/templates/invoices/standard.ejs')
    const config: KickConfig = {
      assetMap: {
        invoices: { src: 'src/templates/invoices', dest: 'dist/templates/invoices' },
      },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(existsSync(join(cwd, 'dist/templates/invoices/standard.ejs'))).toBe(true)
    expect(existsSync(join(cwd, 'dist/invoices/standard.ejs'))).toBe(false)
    // Manifest paths are relative to the manifest's directory (dist/).
    expect(result!.manifest.entries['invoices/standard']).toBe('templates/invoices/standard.ejs')
  })

  it('handles multiple namespaces in one build', async () => {
    writeFile('src/mails/welcome.ejs')
    writeFile('src/reports/monthly.ejs')

    const config: KickConfig = {
      assetMap: {
        mails: { src: 'src/mails' },
        reports: { src: 'src/reports' },
      },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(result!.entries.map((e) => e.namespace).sort()).toEqual(['mails', 'reports'])
    expect(Object.keys(result!.manifest.entries).sort()).toEqual([
      'mails/welcome',
      'reports/monthly',
    ])
  })
})

describe('buildAssets — custom build.outDir', () => {
  it('honours config.build.outDir', async () => {
    writeFile('src/mails/welcome.ejs')
    const config: KickConfig = {
      build: { outDir: 'out' },
      assetMap: { mails: { src: 'src/mails' } },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(existsSync(join(cwd, 'out/mails/welcome.ejs'))).toBe(true)
    expect(existsSync(join(cwd, 'out/.kickjs-assets.json'))).toBe(true)
    expect(existsSync(join(cwd, 'dist/.kickjs-assets.json'))).toBe(false)
    // Manifest paths still relative to the manifest's directory.
    expect(result!.manifest.entries['mails/welcome']).toBe('mails/welcome.ejs')
  })

  it('explicit opts.distDir overrides config.build.outDir', async () => {
    writeFile('src/mails/welcome.ejs')
    const config: KickConfig = {
      build: { outDir: 'out' },
      assetMap: { mails: { src: 'src/mails' } },
    }
    await buildAssets(config, { cwd, distDir: 'override', silent: true })
    expect(existsSync(join(cwd, 'override/mails/welcome.ejs'))).toBe(true)
    expect(existsSync(join(cwd, 'out/mails/welcome.ejs'))).toBe(false)
  })
})

describe('buildAssets — empty / missing config', () => {
  it('returns null when assetMap is absent', async () => {
    const result = await buildAssets({}, { cwd, silent: true })
    expect(result).toBeNull()
    expect(existsSync(join(cwd, 'dist/.kickjs-assets.json'))).toBe(false)
  })

  it('returns null when assetMap is empty', async () => {
    const result = await buildAssets({ assetMap: {} }, { cwd, silent: true })
    expect(result).toBeNull()
  })

  it('records 0 filesCopied when src exists but glob matches nothing', async () => {
    writeFile('src/empty/.gitkeep') // ignored by glob (dot-prefixed)
    const config: KickConfig = {
      assetMap: { empty: { src: 'src/empty', glob: '**/*.ejs' } },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(result!.entries[0].filesCopied).toBe(0)
    expect(result!.manifest.entries).toEqual({})
  })

  it('records 0 filesCopied when src is missing entirely', async () => {
    const config: KickConfig = {
      assetMap: { ghost: { src: 'src/does-not-exist' } },
    }
    const result = await buildAssets(config, { cwd, silent: true })
    expect(result!.entries[0].filesCopied).toBe(0)
  })
})

describe('buildAssets — manifest format', () => {
  it('writes a manifest readable by readAssetManifest', async () => {
    writeFile('src/mails/welcome.ejs')
    const config: KickConfig = { assetMap: { mails: { src: 'src/mails' } } }
    await buildAssets(config, { cwd, silent: true })

    const manifest = readAssetManifest(join(cwd, 'dist'))
    expect(manifest).not.toBeNull()
    expect(manifest!.version).toBe(ASSET_MANIFEST_VERSION)
    expect(manifest!.entries['mails/welcome']).toBe('mails/welcome.ejs')
  })

  it('keys strip only the final extension', async () => {
    writeFile('src/x/multi.dot.ejs')
    const config: KickConfig = { assetMap: { x: { src: 'src/x' } } }
    const result = await buildAssets(config, { cwd, silent: true })
    // Manifest values are relative to the manifest's directory (dist/),
    // so the path includes the namespace folder prefix.
    expect(result!.manifest.entries['x/multi.dot']).toBe('x/multi.dot.ejs')
  })

  it('produces deterministic key order', async () => {
    writeFile('src/x/c.ejs')
    writeFile('src/x/a.ejs')
    writeFile('src/x/b.ejs')

    const config: KickConfig = { assetMap: { x: { src: 'src/x' } } }
    const r1 = await buildAssets(config, { cwd, silent: true })

    rmSync(join(cwd, 'dist'), { recursive: true })
    const r2 = await buildAssets(config, { cwd, silent: true })

    const raw1 = readFileSync(join(cwd, 'dist/.kickjs-assets.json'), 'utf-8')
    expect(raw1).toBe(JSON.stringify(r1!.manifest, null, 2) + '\n')
    expect(JSON.stringify(r1!.manifest)).toBe(JSON.stringify(r2!.manifest))
  })
})

describe('buildAssets — collision handling', () => {
  it('warns when two files in a folder flatten to the same key (index.html + index.js)', async () => {
    writeFile('src/spa/index.html', '<html/>')
    writeFile('src/spa/index.js', 'export {}')

    const config: KickConfig = {
      assetMap: { spa: { src: 'src/spa' } },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await buildAssets(config, { cwd, silent: true })
      // Both files copied verbatim; the manifest holds only one entry
      // for the colliding logical key (last-alphabetical wins).
      expect(existsSync(join(cwd, 'dist/spa/index.html'))).toBe(true)
      expect(existsSync(join(cwd, 'dist/spa/index.js'))).toBe(true)
      expect(result!.manifest.entries['spa/index']).toBe('spa/index.js')
      expect(warnSpy).toHaveBeenCalled()
      const warning = warnSpy.mock.calls[0][0] as string
      expect(warning).toContain('collision')
      expect(warning).toContain('index.html')
      expect(warning).toContain('index.js')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does not warn when same basename lives in different sub-dirs', async () => {
    writeFile('src/spa/foo/index.html')
    writeFile('src/spa/bar/index.html')

    const config: KickConfig = { assetMap: { spa: { src: 'src/spa' } } }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await buildAssets(config, { cwd, silent: true })
      expect(result!.manifest.entries['spa/foo/index']).toBe('spa/foo/index.html')
      expect(result!.manifest.entries['spa/bar/index']).toBe('spa/bar/index.html')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('readAssetManifest', () => {
  it('returns null when no manifest file exists', () => {
    expect(readAssetManifest(cwd)).toBeNull()
  })

  it('returns null on a malformed manifest', () => {
    mkdirSync(join(cwd, 'dist'), { recursive: true })
    writeFileSync(join(cwd, 'dist/.kickjs-assets.json'), 'not valid json')
    expect(readAssetManifest(join(cwd, 'dist'))).toBeNull()
  })

  it('returns null on a future-version manifest', () => {
    mkdirSync(join(cwd, 'dist'), { recursive: true })
    writeFileSync(
      join(cwd, 'dist/.kickjs-assets.json'),
      JSON.stringify({ version: 99, entries: {} }),
    )
    expect(readAssetManifest(join(cwd, 'dist'))).toBeNull()
  })
})
