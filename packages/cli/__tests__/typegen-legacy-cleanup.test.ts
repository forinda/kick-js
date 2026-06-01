/**
 * Plugin-only typegen migration regressions.
 *
 * The monolithic `generator.ts` is gone — every `.kickjs/types/*` file
 * is now emitted by an isolated typegen plugin (`kick/registry`,
 * `kick/services`, `kick/modules`, `kick/plugins`, `kick/augmentations`,
 * plus the carved `kick/routes`/`kick/env`/`kick/assets`/`kick/db`).
 * This file covers:
 *
 *  1. The pure manifest renderers (moved out of `generator.ts` into
 *     `render/manifest.ts`) still produce the expected augmentations +
 *     unions.
 *  2. `sweepStaleTypegen` removes EVERY legacy generator filename left
 *     by an older CLI (`registry.d.ts`, `services.d.ts`, `modules.d.ts`,
 *     `plugins.d.ts`, `augmentations.d.ts`, `index.d.ts`, plus the
 *     earlier `assets.d.ts`/`env.ts`/`routes.ts`) — and ONLY those known
 *     names. It is an allowlist, not a denylist: unknown/custom files
 *     are always preserved so an aborted plugin pass can never wipe live
 *     `kick__*` output.
 *
 * @module @forinda/kickjs-cli/__tests__/typegen-legacy-cleanup.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sweepStaleTypegen } from '../src/typegen'
import {
  buildModuleTokens,
  buildServiceTokens,
  renderAugmentations,
  renderPlugins,
  renderRegistry,
  renderUnion,
} from '../src/typegen/render/manifest'

let outDir: string

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'typegen-plugin-only-'))
})

afterEach(() => {
  try {
    rmSync(outDir, { recursive: true, force: true })
  } catch {
    /* ignore cleanup races */
  }
})

describe('render/manifest renderers', () => {
  // Static paths — these renderers are pure, so the fixtures don't need
  // the per-test temp dir (and must not read `outDir`, which is unset at
  // describe-eval time).
  const classes = [
    {
      className: 'UserService',
      decorator: 'Service',
      isDefault: false,
      filePath: '/proj/src/user.service.ts',
      relativePath: 'src/user.service.ts',
    },
    {
      className: 'AppModule',
      decorator: 'Module',
      isDefault: false,
      filePath: '/proj/src/app.module.ts',
      relativePath: 'src/app.module.ts',
    },
  ] as never[]

  it('renderRegistry maps registry-decorated classes to import() refs', () => {
    const out = renderRegistry(classes, '/proj/.kickjs/types/kick__registry.d.ts', new Set())
    expect(out).toContain("declare module '@forinda/kickjs'")
    expect(out).toContain('interface KickJsRegistry')
    expect(out).toContain("'UserService': import(")
    // @Module classes are not DI registry entries.
    expect(out).not.toContain("'AppModule':")
  })

  it('buildServiceTokens + renderUnion emit a sorted ServiceToken union', () => {
    const names = buildServiceTokens(
      classes,
      [{ name: 'TOKEN_B' }] as never,
      [{ name: 'TOKEN_A' }] as never,
      new Set(),
    )
    const out = renderUnion('ServiceToken', names, 'none')
    expect(out).toContain('export type ServiceToken =')
    expect(out).toContain("| 'TOKEN_A'")
    expect(out).toContain("| 'UserService'")
  })

  it('buildModuleTokens picks up @Module class names', () => {
    expect(buildModuleTokens(classes)).toEqual(['AppModule'])
  })

  it('renderPlugins emits a KickJsPluginRegistry keyed by name', () => {
    const out = renderPlugins([{ name: 'TenantAdapter', kind: 'adapter' }] as never)
    expect(out).toContain('interface KickJsPluginRegistry')
    expect(out).toContain("'TenantAdapter': 'adapter'")
  })

  it('renderAugmentations catalogues defineAugmentation calls', () => {
    const out = renderAugmentations([
      { name: 'FeatureFlags', relativePath: 'src/flags.ts' },
    ] as never)
    expect(out).toContain('export interface FeatureFlagsAugmentation {}')
  })
})

describe('sweepStaleTypegen — plugin-only migration', () => {
  const LEGACY = [
    'assets.d.ts',
    'env.ts',
    'routes.ts',
    'registry.d.ts',
    'services.d.ts',
    'modules.d.ts',
    'plugins.d.ts',
    'augmentations.d.ts',
    'index.d.ts',
  ]
  const CURRENT = [
    'kick__registry.d.ts',
    'kick__services.d.ts',
    'kick__modules.d.ts',
    'kick__plugins.d.ts',
    'kick__augmentations.d.ts',
    'kick__routes.ts',
    'kick__env.ts',
    'kick__assets.d.ts',
  ]

  it('removes every legacy generator filename left by older CLI versions', async () => {
    await mkdir(outDir, { recursive: true })
    for (const f of LEGACY) writeFileSync(join(outDir, f), '/* legacy */')
    for (const f of CURRENT) writeFileSync(join(outDir, f), '/* current */')
    const pluginResults = CURRENT.map((f) => ({
      id: `kick/${f}`,
      status: 'written' as const,
      outFile: join(outDir, f),
    }))

    const removed = await sweepStaleTypegen(outDir, [], pluginResults, true)

    expect(removed.toSorted()).toEqual([...LEGACY].toSorted())
    for (const f of LEGACY) expect(existsSync(join(outDir, f)), f).toBe(false)
    for (const f of CURRENT) expect(existsSync(join(outDir, f)), f).toBe(true)
  })

  it('preserves unknown/custom files — only known legacy orphans are candidates', async () => {
    // The sweep used to be a denylist ("delete anything not expected"),
    // which let an aborted plugin pass (empty pluginResults) wipe live
    // files. It's now an allowlist, so unknown files are always kept.
    await mkdir(outDir, { recursive: true })
    writeFileSync(join(outDir, 'kick__registry.d.ts'), '/* plugin */')
    writeFileSync(join(outDir, 'kick__routes.ts'), '/* plugin */')
    writeFileSync(join(outDir, 'leftover.d.ts'), '/* custom — must survive */')

    const removed = await sweepStaleTypegen(outDir, [], [], true)
    expect(removed).toEqual([])
    expect(existsSync(join(outDir, 'kick__registry.d.ts'))).toBe(true)
    expect(existsSync(join(outDir, 'kick__routes.ts'))).toBe(true)
    expect(existsSync(join(outDir, 'leftover.d.ts'))).toBe(true)
  })

  it('keeps a legacy-named file when the runner reported it as a plugin output', async () => {
    await mkdir(outDir, { recursive: true })
    writeFileSync(join(outDir, 'index.d.ts'), '/* still owned */')
    const removed = await sweepStaleTypegen(
      outDir,
      [],
      [{ id: 'legacy/index', status: 'written', outFile: join(outDir, 'index.d.ts') }],
      true,
    )
    expect(removed).toEqual([])
    expect(existsSync(join(outDir, 'index.d.ts'))).toBe(true)
  })

  it('returns an empty list when there are no orphans', async () => {
    await mkdir(outDir, { recursive: true })
    for (const f of CURRENT) writeFileSync(join(outDir, f), '/* current */')
    const removed = await sweepStaleTypegen(outDir, [], [], true)
    expect(removed).toEqual([])
  })

  it('tolerates a missing outDir without throwing', async () => {
    const removed = await sweepStaleTypegen(join(outDir, 'does-not-exist'), [], [], true)
    expect(removed).toEqual([])
  })
})
