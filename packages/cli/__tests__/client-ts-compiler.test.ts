/**
 * The compiler API is optional and version-sensitive: it must come from the
 * ADOPTER's node_modules, because a program built by a different TypeScript
 * than the one checking the server can resolve types differently — and a
 * client map that disagrees with the server is worse than no client map.
 *
 * TypeScript 7 ships no JS compiler API, so `typescript` may resolve to a
 * package with no `createProgram`. That is the fallback trigger, not an error.
 *
 * @module @forinda/kickjs-cli/__tests__/client-ts-compiler.test
 */

import { describe, expect, it, vi } from 'vitest'
import { pickCompilerModule } from '../src/typegen/client/ts-compiler'

describe('pickCompilerModule', () => {
  it('takes typescript when it exposes createProgram', () => {
    const pick = pickCompilerModule({
      typescript: { createProgram: vi.fn() },
      ts6: { createProgram: vi.fn() },
    })
    expect(pick.source).toBe('typescript')
  })

  it('falls back when typescript has no compiler API (TS 7)', () => {
    // TS 7's `typescript` package: a CLI, not an API.
    const pick = pickCompilerModule({
      typescript: { version: '7.0.2' },
      ts6: { createProgram: vi.fn() },
    })
    expect(pick.source).toBe('@typescript/typescript6')
  })

  it('reports both candidates as missing rather than guessing', () => {
    expect(() => pickCompilerModule({ typescript: null, ts6: null })).toThrow(
      /pnpm add -D @typescript\/typescript6/,
    )
  })

  it('names the TS 7 case specifically when only typescript is present', () => {
    expect(() => pickCompilerModule({ typescript: { version: '7.0.2' }, ts6: null })).toThrow(
      /TypeScript 7 does not ship a compiler API/,
    )
  })
})
