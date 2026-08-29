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
    const { ctx, log, getScanResult } = makeCtx({ watch: true })

    expect(await kickClientTypegen().generate(ctx)).toBeNull()

    expect(log.info.mock.calls.flat().join(' ')).toContain('watch')
    // The expensive part must not even be reached.
    expect(getScanResult).not.toHaveBeenCalled()
  })

  it('warns and skips on any resolution failure, instead of failing typegen', async () => {
    const { ctx, log } = makeCtx()

    // An unusable project — no tsconfig, no routes file, possibly no compiler
    // API. Every one of those means "skip this file", never "fail the pass":
    // this plugin runs for every adopter, and an additive feature must not
    // turn into a hard break. (The compiler-API message itself is asserted in
    // client-ts-compiler.test.ts, where the decision lives.)
    expect(await kickClientTypegen().generate(ctx)).toBeNull()
    expect(log.warn.mock.calls.flat().join(' ')).toContain('kick/client: skipped')
  })

  it('runs the resolution when not watching', async () => {
    // Guards against "skipped" becoming the only path: the watch check must
    // be the reason for the skip above, not an unconditional return.
    const { ctx, getScanResult } = makeCtx()

    await kickClientTypegen().generate(ctx)

    expect(getScanResult).toHaveBeenCalled()
  })
})
