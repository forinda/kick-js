/**
 * Regressions for the duplicate-legacy-types fix:
 *
 *  1. `generateTypes` no longer writes `assets.d.ts`. The KickAssets
 *     augmentation is owned exclusively by the `kick/assets` typegen
 *     plugin (`kick__assets.d.ts`). Pre-fix, both files existed and
 *     adopters got `interface KickAssets` declared twice — silent
 *     interface merge today, TS2717 on the next field rename.
 *  2. `index.d.ts` only side-effect-imports `./kick__assets` when the
 *     plugin actually emits it (i.e. assetMap is non-empty). With no
 *     assets, the import would dangle.
 *  3. `sweepStaleTypegen` removes orphaned files left by older CLI
 *     versions (`assets.d.ts`, `env.ts`, `routes.ts`) — and ONLY those
 *     known legacy names. It is an allowlist, not a denylist: unknown /
 *     custom files are always preserved so an aborted plugin pass can
 *     never wipe live output (e.g. `kick__routes.ts`).
 *
 * @module @forinda/kickjs-cli/__tests__/typegen-legacy-cleanup.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateTypes } from '../src/typegen/generator'
import { sweepStaleTypegen } from '../src/typegen'

let outDir: string

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'typegen-legacy-cleanup-'))
})

afterEach(() => {
  try {
    rmSync(outDir, { recursive: true, force: true })
  } catch {
    /* ignore cleanup races */
  }
})

describe('generator stops emitting legacy assets.d.ts', () => {
  it('does not write `assets.d.ts` even when assetMap entries exist', async () => {
    await generateTypes({
      classes: [],
      outDir,
      assets: {
        count: 2,
        entries: [
          {
            namespace: 'mails',
            src: '/abs/src/mails',
            dest: 'dist/mails',
            keys: ['welcome', 'reset'],
          },
        ],
      },
    })

    expect(existsSync(join(outDir, 'assets.d.ts'))).toBe(false)
    // The other generator-owned files DO still exist — sanity check
    // that the test isn't passing because the whole output dir is
    // empty.
    for (const f of [
      'registry.d.ts',
      'services.d.ts',
      'modules.d.ts',
      'plugins.d.ts',
      'augmentations.d.ts',
      'index.d.ts',
    ]) {
      expect(existsSync(join(outDir, f)), f).toBe(true)
    }
  })

  it('omits the assets-import line in index.d.ts when no assets are discovered', async () => {
    await generateTypes({
      classes: [],
      outDir,
      assets: { count: 0, entries: [] },
    })
    const index = readFileSync(join(outDir, 'index.d.ts'), 'utf-8')
    expect(index).not.toContain("import './kick__assets'")
    expect(index).not.toContain("import './assets'")
  })

  it('side-effect-imports `./kick__assets` (not `./assets`) when assetMap is populated', async () => {
    await generateTypes({
      classes: [],
      outDir,
      assets: {
        count: 1,
        entries: [
          {
            namespace: 'mails',
            src: '/abs/src/mails',
            dest: 'dist/mails',
            keys: ['welcome'],
          },
        ],
      },
    })
    const index = readFileSync(join(outDir, 'index.d.ts'), 'utf-8')
    expect(index).toContain("import './kick__assets'")
    expect(index).not.toContain("import './assets'\n")
  })
})

describe('sweepStaleTypegen', () => {
  it('removes legacy env.ts/routes.ts/assets.d.ts left by older CLI versions', async () => {
    await mkdir(outDir, { recursive: true })
    // Seed: stale legacy outputs from a pre-carve CLI.
    for (const f of ['env.ts', 'routes.ts', 'assets.d.ts']) {
      writeFileSync(join(outDir, f), '/* legacy */')
    }
    // Plus the current expected outputs from generator + plugin runner.
    const expected = [
      'registry.d.ts',
      'services.d.ts',
      'modules.d.ts',
      'plugins.d.ts',
      'augmentations.d.ts',
      'index.d.ts',
    ]
    for (const f of expected) writeFileSync(join(outDir, f), '/* current */')
    const pluginResults = [
      { id: 'kick/routes', status: 'written' as const, outFile: join(outDir, 'kick__routes.ts') },
      { id: 'kick/env', status: 'written' as const, outFile: join(outDir, 'kick__env.ts') },
    ]
    for (const r of pluginResults) writeFileSync(r.outFile!, '/* plugin */')

    const removed = await sweepStaleTypegen(
      outDir,
      expected.map((f) => join(outDir, f)),
      pluginResults,
      true,
    )

    expect(removed.toSorted()).toEqual(['assets.d.ts', 'env.ts', 'routes.ts'])
    expect(existsSync(join(outDir, 'assets.d.ts'))).toBe(false)
    expect(existsSync(join(outDir, 'env.ts'))).toBe(false)
    expect(existsSync(join(outDir, 'routes.ts'))).toBe(false)
    // Current outputs survive.
    for (const f of expected) expect(existsSync(join(outDir, f)), f).toBe(true)
    expect(existsSync(join(outDir, 'kick__routes.ts'))).toBe(true)
    expect(existsSync(join(outDir, 'kick__env.ts'))).toBe(true)
  })

  it('returns an empty list when there are no orphans', async () => {
    await mkdir(outDir, { recursive: true })
    const expected = ['registry.d.ts', 'services.d.ts', 'index.d.ts']
    for (const f of expected) writeFileSync(join(outDir, f), '/* current */')

    const removed = await sweepStaleTypegen(
      outDir,
      expected.map((f) => join(outDir, f)),
      [],
      true,
    )
    expect(removed).toEqual([])
  })

  it('tolerates a missing outDir without throwing', async () => {
    const removed = await sweepStaleTypegen(join(outDir, 'does-not-exist'), [], [], true)
    expect(removed).toEqual([])
  })

  it('preserves unknown/custom files — only known legacy orphans are candidates', async () => {
    // Safety regression: the sweep used to be a denylist ("delete
    // anything not in the expected set"). That meant an aborted plugin
    // pass (empty pluginResults) could delete live files like
    // `kick__routes.ts` — wiping controller route types project-wide.
    // It's now an allowlist of pre-carve legacy filenames, so unknown
    // files are always left alone regardless of the expected set.
    await mkdir(outDir, { recursive: true })
    writeFileSync(join(outDir, 'kick__assets.d.ts'), '/* plugin */')
    writeFileSync(join(outDir, 'kick__routes.ts'), '/* plugin */')
    writeFileSync(join(outDir, 'leftover.d.ts'), '/* custom — must survive */')

    // Empty generator + plugin results simulate the aborted-pass case.
    const removed = await sweepStaleTypegen(outDir, [], [], true)
    expect(removed).toEqual([])
    expect(existsSync(join(outDir, 'kick__assets.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, 'kick__routes.ts'))).toBe(true)
    expect(existsSync(join(outDir, 'leftover.d.ts'))).toBe(true)
  })

  it('keeps a legacy-named file when the runner reported it as a plugin output', async () => {
    // Contrived collision: a plugin output whose filename matches a
    // legacy orphan name. The reported `outFile` wins — never swept.
    await mkdir(outDir, { recursive: true })
    writeFileSync(join(outDir, 'assets.d.ts'), '/* still owned */')
    const removed = await sweepStaleTypegen(
      outDir,
      [],
      [{ id: 'legacy/assets', status: 'written', outFile: join(outDir, 'assets.d.ts') }],
      true,
    )
    expect(removed).toEqual([])
    expect(existsSync(join(outDir, 'assets.d.ts'))).toBe(true)
  })
})
