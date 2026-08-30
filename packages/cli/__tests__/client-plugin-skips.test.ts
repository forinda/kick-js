/**
 * Both skips exist to protect something that already works: the sub-second
 * `kick dev` loop, and `kick typegen` on a project with no compiler API
 * (TypeScript 7 ships none — see client-ts-compiler.test.ts).
 *
 * A regression in either is silent — the file just stops being emitted, or
 * the whole pass starts failing — so they get an explicit test.
 *
 * @module @forinda/kickjs-cli/__tests__/client-plugin-skips.test
 */

import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { kickClientTypegen } from '../src/typegen/builtin/client'
import type { TypegenContext } from '../src/typegen/plugin'

function makeCtx(over: Partial<TypegenContext> = {}) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const getScanResult = vi.fn().mockResolvedValue({ routes: [] })
  return {
    ctx: {
      cwd: '/nonexistent-kick-project',
      config: {},
      importTs: vi.fn(),
      writeFile: vi.fn(),
      getScanResult,
      log,
      ...over,
    } as unknown as TypegenContext,
    log,
    getScanResult,
  }
}

describe('kick/client plugin', () => {
  it('emits nothing under watch, and says why', async () => {
    // Opted in, so the watch check is what this exercises — the wanted/not
    // gate runs first and would otherwise skip for a different reason.
    const { ctx, log, getScanResult } = makeCtx({
      watch: true,
      config: { typegen: { client: true } },
    })

    expect(await kickClientTypegen().generate(ctx)).toBeNull()

    expect(log.info.mock.calls.flat().join(' ')).toContain('watch')
    // The expensive part must not even be reached.
    expect(getScanResult).not.toHaveBeenCalled()
  })

  it('does nothing at all for a project that never asked for the map', async () => {
    // The reason this gate exists: producing the map builds a TypeScript
    // program over the server. Measured on a 1,940-route API, the whole
    // typegen pass goes 7.50s / 1127 MB with the map to 0.59s / 182 MB
    // without. An API with no frontend should not pay that for a file nothing
    // reads — and most projects have no frontend.
    const { ctx, getScanResult } = makeCtx()

    expect(await kickClientTypegen().generate(ctx)).toBeNull()
    // Not even the scan: the gate is checked before any work.
    expect(getScanResult).not.toHaveBeenCalled()
  })

  it('runs when the config asks for it', async () => {
    const { ctx, getScanResult } = makeCtx({ config: { typegen: { client: true } } })

    await kickClientTypegen().generate(ctx)

    expect(getScanResult).toHaveBeenCalled()
  })

  it('does not infer "on" from the file being there, but says so', async () => {
    // Inferring from disk would put the switch somewhere nobody looks: a
    // project paying seconds and a gigabyte per typegen because of a file,
    // with nothing in its config explaining why. Config is the switch.
    //
    // A map left to rot is still worth a word — that is how a frontend ends
    // up type-checking against routes the server no longer serves.
    const dir = mkdtempSync(join(tmpdir(), 'kick-gate-'))
    try {
      mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
      writeFileSync(join(dir, '.kickjs/types/kick__client.d.ts'), 'export {}\n')

      const { ctx, log, getScanResult } = makeCtx({ cwd: dir })
      expect(await kickClientTypegen().generate(ctx)).toBeNull()

      expect(getScanResult).not.toHaveBeenCalled()
      const warned = log.warn.mock.calls.flat().join(' ')
      expect(warned).toContain('typegen.client')
      expect(warned).toContain('NOT')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stays off when explicitly disabled, even with the map on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-gate-'))
    try {
      mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
      writeFileSync(join(dir, '.kickjs/types/kick__client.d.ts'), 'export {}\n')

      const { ctx, getScanResult } = makeCtx({
        cwd: dir,
        config: { typegen: { client: false } },
      })
      expect(await kickClientTypegen().generate(ctx)).toBeNull()
      expect(getScanResult).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stays quiet when the project never had a client map', async () => {
    // This plugin runs for every adopter, and most do not consume the map:
    // the fullstack template's web app is wired to the ambient KickRoutes.Api,
    // and rest/minimal have no frontend at all. Warning on every
    // `kick typegen` about a file they do not use is pure noise — and the
    // compiler API it needs pulls a second TypeScript, so "just install it"
    // is not a free answer either.
    const { ctx, log } = makeCtx()

    expect(await kickClientTypegen().generate(ctx)).toBeNull()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns loudly when a map WAS on disk, because that is a regression', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-skip-'))
    try {
      mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
      const out = join(dir, '.kickjs/types/kick__client.d.ts')
      writeFileSync(out, 'export interface KickApi {}\n')

      const { ctx, log } = makeCtx({ cwd: dir, config: { typegen: { client: true } } })
      expect(await kickClientTypegen().generate(ctx)).toBeNull()

      const warnings = log.warn.mock.calls.flat().join(' ')
      expect(warnings).toContain('kick/client: skipped')
      // Missing beats stale: a frontend importing a deleted file fails to
      // compile immediately, where an obsolete map type-checks cleanly
      // against routes the server no longer serves.
      expect(warnings).toContain('removed the previously generated')
      expect(existsSync(out)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs the resolution when not watching', async () => {
    // Guards against "skipped" becoming the only path: the watch check must
    // be the reason for the skip above, not an unconditional return.
    const { ctx, getScanResult } = makeCtx({ config: { typegen: { client: true } } })

    await kickClientTypegen().generate(ctx)

    expect(getScanResult).toHaveBeenCalled()
  })

  it('deletes a stale map when a one-shot run fails, rather than leaving a lie', async () => {
    // A MISSING map is a compile error in the frontend — loud and obviously
    // about this. A STALE one type-checks perfectly against routes the server
    // no longer serves. Silence is the dangerous outcome, so prefer the noise.
    const dir = mkdtempSync(join(tmpdir(), 'kick-stale-'))
    try {
      mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
      const out = join(dir, '.kickjs/types/kick__client.d.ts')
      writeFileSync(out, 'export interface KickApi { "GET /gone": never }\n')

      const { ctx, log } = makeCtx({ cwd: dir, config: { typegen: { client: true } } })
      expect(await kickClientTypegen().generate(ctx)).toBeNull()

      expect(existsSync(out)).toBe(false)
      expect(log.warn.mock.calls.flat().join(' ')).toContain('removed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the last good map when the skip is the watch one', async () => {
    // The dev loop deliberately leaves the file alone; deleting it there would
    // break the frontend on every save.
    const dir = mkdtempSync(join(tmpdir(), 'kick-watch-'))
    try {
      mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
      const out = join(dir, '.kickjs/types/kick__client.d.ts')
      writeFileSync(out, 'export interface KickApi {}\n')

      const { ctx } = makeCtx({ cwd: dir, watch: true })
      expect(await kickClientTypegen().generate(ctx)).toBeNull()

      expect(existsSync(out)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('kick/client depth configuration', () => {
  it('treats an object config as on, so { maxDepth } alone reads the way it looks', async () => {
    const { ctx, getScanResult } = makeCtx({ config: { typegen: { client: { maxDepth: 24 } } } })
    await kickClientTypegen().generate(ctx)
    expect(getScanResult).toHaveBeenCalled()
  })

  it('still honours an explicit opt-out on the object form', async () => {
    const { ctx, getScanResult } = makeCtx({
      config: { typegen: { client: { enabled: false, maxDepth: 24 } } },
    })
    expect(await kickClientTypegen().generate(ctx)).toBeNull()
    expect(getScanResult).not.toHaveBeenCalled()
  })
})
