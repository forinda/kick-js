/**
 * The emitted file has exactly one job: compile in a frontend that knows
 * nothing about the server. So the assertions are mostly about what is ABSENT
 * — no imports, no ambient `declare global`, no reference to server paths.
 *
 * @module @forinda/kickjs-cli/__tests__/client-render.test
 */

import { describe, expect, it } from 'vitest'

import { renderClient } from '../src/typegen/render/client'

/** Code lines only — the header comment carries a usage example that names an import. */
const code = (out: string) =>
  out
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

describe('renderClient', () => {
  it('emits a module-scoped interface with no imports', () => {
    const out = renderClient(
      {
        entries: new Map([['GET /terms', '{ params: {}; response: __T0[] }']]),
        hoisted: ['interface __T0 {\n  id: string\n}'],
      },
      ['GET /terms'],
    )

    expect(out).toContain('export interface KickApi {')
    expect(out).toContain('"GET /terms": { params: {}; response: __T0[] }')
    expect(out).toContain('interface __T0 {')
    expect(code(out)).not.toContain('import ')
    expect(code(out)).not.toContain('declare global')
  })

  it('still emits a usable empty map before the first route exists', () => {
    const out = renderClient({ entries: new Map(), hoisted: [] }, [])
    expect(out).toContain('export interface KickApi {}')
  })

  it('emits the empty map rather than a broken one when every key was skipped', () => {
    // Keys with no resolved entry would otherwise render as `'K': undefined`.
    const out = renderClient({ entries: new Map(), hoisted: [] }, ['GET /ghost'])
    expect(out).toContain('export interface KickApi {}')
    expect(out).not.toContain('ghost')
  })

  it('says the file is not refreshed by kick dev', () => {
    // The one thing an adopter can be surprised by: a stale map after a save.
    const out = renderClient({ entries: new Map(), hoisted: [] }, [])
    expect(out).toContain('kick dev')
  })
})
