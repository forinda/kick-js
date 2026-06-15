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

/**
 * `resolveAsset` normalises returned paths to posix (forward slashes)
 * on every platform so adopters can splice them into URLs and compare
 * them across hosts. Tests construct expected paths via `join(cwd,
 * 'rel/path')` which yields backslashes on Windows — wrap with
 * `toPosix()` so assertions hold on both Windows and posix CI.
 */
const toPosix = (p: string): string => p.replaceAll('\\', '/')
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
let originalNodeEnv: string | undefined

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-assets-runtime-'))
  originalCwd = process.cwd()
  originalEnvRoot = process.env.KICK_ASSETS_ROOT
  // The runtime resolver intentionally skips its module-level cache
  // outside production so adding/removing template files in dev shows
  // up immediately. These tests assert cache-aware behaviour (manifest
  // discovery, swap-via-clear, etc.) and need the prod codepath.
  originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
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
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
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
    expect(path).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
  })

  it('honours absolute manifest entries verbatim', () => {
    const abs = join(cwd, 'somewhere/else/file.txt')
    writeFile('somewhere/else/file.txt')
    writeManifest('dist', { 'x/y': abs })
    expect(resolveAsset('x', 'y')).toBe(toPosix(abs))
  })

  it('also probes build/ + out/ for the manifest', () => {
    writeManifest('out', { 'reports/monthly': 'reports/monthly.ejs' })
    writeFile('out/reports/monthly.ejs')
    expect(resolveAsset('reports', 'monthly')).toBe(toPosix(join(cwd, 'out/reports/monthly.ejs')))
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
    expect(resolveAsset('mails', 'welcome')).toBe(toPosix(join(cwd, 'custom/mails/welcome.ejs')))
  })

  it('falls back to dist when the env path has no manifest', () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    process.env.KICK_ASSETS_ROOT = join(cwd, 'nonexistent')
    clearAssetCache()
    expect(resolveAsset('mails', 'welcome')).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
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

    expect(resolveAsset('mails', 'welcome')).toBe(
      toPosix(join(cwd, 'src/templates/mails/welcome.ejs')),
    )
    expect(resolveAsset('mails', 'orders/confirmation')).toBe(
      toPosix(join(cwd, 'src/templates/mails/orders/confirmation.ejs')),
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

    expect(resolveAsset('x', 'keep')).toBe(toPosix(join(cwd, 'src/x/keep.ejs')))
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

describe('resolveAsset — dev mode prefers the live source tree', () => {
  // The shared beforeEach pins NODE_ENV=production; these cases need the
  // dev codepath, so each flips it back to a non-prod value.
  beforeEach(() => {
    process.env.NODE_ENV = 'development'
    clearAssetCache()
  })

  it('walks src/ instead of a stale dist/.kickjs-assets.json', () => {
    // An earlier `kick build` left a built manifest on disk pointing at a
    // file that no longer reflects the source tree. Dev must NOT read it.
    writeManifest('dist', { 'mails/welcome': 'mails/stale.ejs' })
    writeFile('dist/mails/stale.ejs', 'stale')
    writeFile(
      'kick.config.json',
      JSON.stringify({ assetMap: { mails: { src: 'src/templates/mails' } } }),
    )
    writeFile('src/templates/mails/welcome.ejs', 'fresh')

    expect(resolveAsset('mails', 'welcome')).toBe(
      toPosix(join(cwd, 'src/templates/mails/welcome.ejs')),
    )
  })

  it('picks up a newly-added file without a cache clear or restart', () => {
    writeFile(
      'kick.config.json',
      JSON.stringify({ assetMap: { mails: { src: 'src/templates/mails' } } }),
    )
    writeFile('src/templates/mails/welcome.ejs', 'hi')
    // Prime the resolver once.
    expect(resolveAsset('mails', 'welcome')).toBe(
      toPosix(join(cwd, 'src/templates/mails/welcome.ejs')),
    )

    // Drop a new template in — no clearAssetCache(), no restart.
    writeFile('src/templates/mails/reminder.ejs', 'remember')
    expect(resolveAsset('mails', 'reminder')).toBe(
      toPosix(join(cwd, 'src/templates/mails/reminder.ejs')),
    )
  })

  it('still falls back to a built manifest when no assetMap config exists', () => {
    // No kick.config / assetMap to walk — the dev src-walk returns null,
    // so a dev running purely off a dist build must still resolve.
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs', 'built')

    expect(resolveAsset('mails', 'welcome')).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
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
    expect(path).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
  })

  it('resolves nested access (assets.mails.orders.confirmation())', () => {
    writeManifest('dist', { 'mails/orders/confirmation': 'mails/orders/confirmation.ejs' })
    writeFile('dist/mails/orders/confirmation.ejs')
    const path = (assets as any).mails.orders.confirmation()
    expect(path).toBe(toPosix(join(cwd, 'dist/mails/orders/confirmation.ejs')))
  })

  it('returns undefined for thenable detection (Promise.resolve unwrap)', () => {
    // `then` MUST return undefined so `await assets` resolves to the
    // Proxy itself instead of going recursive.
    expect((assets as any).then).toBeUndefined()
    // Vitest matchers probe `asymmetricMatch` to detect partial matchers;
    // returning a Proxy here breaks deep-equality assertions.
    expect((assets as any).asymmetricMatch).toBeUndefined()
  })

  it('passes coercion keys through to Object.prototype defaults', () => {
    // toString / valueOf / Symbol.toPrimitive must return their default
    // function so `String(assets)`, template literals, etc. produce
    // `[object Object]` rather than triggering a recursive resolve attempt.
    expect(typeof (assets as any).toString).toBe('function')
    expect(String(assets)).toBe('[object Object]')
  })

  it('supports computed namespace lookups via bracket access', () => {
    writeManifest('dist', { 'reports/monthly': 'reports/monthly.ejs' })
    writeFile('dist/reports/monthly.ejs')
    const ns = 'reports'
    const key = 'monthly'
    const path = (assets as any)[ns][key]()
    expect(path).toBe(toPosix(join(cwd, 'dist/reports/monthly.ejs')))
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
    expect(new MailService().welcome()).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
  })
})

describe('ASSETS DI token', () => {
  it('uses the kick/assets/Map convention name', () => {
    expect(ASSETS.name).toBe('kick/assets/Map')
  })
})

describe('@Asset decorator', () => {
  it('injects the resolved path into a class field on access', async () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    const { Asset, Container, Service } = await import('../src')
    Container.reset()

    @Service()
    class MailService {
      @Asset('mails/welcome')
      welcomeTemplate!: string
    }

    Container.getInstance().register(MailService, MailService)
    const svc = Container.getInstance().resolve(MailService)
    expect(svc.welcomeTemplate).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
  })

  it('resolves nested-path assets (mails/orders/confirmation)', async () => {
    writeManifest('dist', { 'mails/orders/confirmation': 'mails/orders/confirmation.ejs' })
    writeFile('dist/mails/orders/confirmation.ejs')
    const { Asset, Container, Service } = await import('../src')
    Container.reset()

    @Service()
    class MailService {
      @Asset('mails/orders/confirmation')
      orderConfirmation!: string
    }

    Container.getInstance().register(MailService, MailService)
    const svc = Container.getInstance().resolve(MailService)
    expect(svc.orderConfirmation).toBe(toPosix(join(cwd, 'dist/mails/orders/confirmation.ejs')))
  })

  it('is lazy — resolves on access, not at instantiation', async () => {
    const { Asset, Container, Service } = await import('../src')
    Container.reset()

    @Service()
    class Lazy {
      @Asset('mails/welcome')
      template!: string
    }

    // Instantiation must NOT throw even though the asset doesn't exist yet
    Container.getInstance().register(Lazy, Lazy)
    const inst = Container.getInstance().resolve(Lazy)

    // Set up the asset AFTER the class is constructed
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    clearAssetCache()

    expect(inst.template).toBe(toPosix(join(cwd, 'dist/mails/welcome.ejs')))
  })

  it('throws UnknownAssetError on access for missing assets', async () => {
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    const { Asset, Container, Service } = await import('../src')
    Container.reset()

    @Service()
    class Bad {
      @Asset('mails/nonexistent')
      template!: string
    }

    Container.getInstance().register(Bad, Bad)
    const inst = Container.getInstance().resolve(Bad)
    expect(() => inst.template).toThrow(UnknownAssetError)
  })

  it("throws at instantiation when the key has no '/' separator", async () => {
    const { Asset, Container, Service } = await import('../src')
    Container.reset()

    @Service()
    class Malformed {
      @Asset('no-slash-here')
      template!: string
    }

    Container.getInstance().register(Malformed, Malformed)
    expect(() => Container.getInstance().resolve(Malformed)).toThrow(/must include a '\/'/)
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

describe('dev-mode cache skip — file changes visible without restart', () => {
  it('observes a fresh file on the next call without manual cache clear', () => {
    process.env.NODE_ENV = 'development'
    writeManifest('dist', { 'mails/welcome': 'mails/welcome.ejs' })
    writeFile('dist/mails/welcome.ejs')
    expect(resolveAsset('mails', 'welcome')).toContain('mails/welcome.ejs')

    // Drop a new template + add it to the manifest — in dev the next
    // `resolveAsset` call must re-discover, no `clearAssetCache()` call
    // required from user code or the dev watcher.
    cpSync(join(cwd, 'dist/mails/welcome.ejs'), join(cwd, 'dist/mails/follow-up.ejs'))
    writeManifest('dist', {
      'mails/welcome': 'mails/welcome.ejs',
      'mails/follow-up': 'mails/follow-up.ejs',
    })

    expect(resolveAsset('mails', 'follow-up')).toContain('mails/follow-up.ejs')
  })
})
