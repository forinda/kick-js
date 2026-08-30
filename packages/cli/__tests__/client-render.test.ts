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
  it('emits no imports, and exposes only the namespace globally', () => {
    const out = renderClient(
      {
        entries: new Map([['GET /terms', '{ params: {}; response: __T0[] }']]),
        hoisted: ['interface __T0 {\n  id: string\n}'],
      },
      ['GET /terms'],
    )

    expect(out).toContain('namespace KickClientApi {')
    // Module-local, so the 86 hoisted shapes of a real app do not land in the
    // consuming frontend's global scope.
    expect(out).toContain('interface Api {')
    expect(out).toContain('export type { Api }')
    // NOT a global `KickApi`: kick__routes.ts already declares one, and both
    // files sit in .kickjs/types which the server's own tsconfig includes.
    expect(out).not.toContain('type KickApi')
    expect(out).toContain('"GET /terms": { params: {}; response: __T0[] }')
    expect(out).toContain('interface __T0 {')
    expect(code(out)).not.toContain('import ')
    // One global namespace, and nothing else ambient: the hoisted `__T<n>`
    // shapes must not reach the consuming frontend's global scope.
    expect(out.match(/declare global/g)).toHaveLength(1)
  })

  it('still emits a usable empty map before the first route exists', () => {
    const out = renderClient({ entries: new Map(), hoisted: [] }, [])
    expect(out).toContain('interface Api {}')
  })

  it('emits the empty map rather than a broken one when every key was skipped', () => {
    // Keys with no resolved entry would otherwise render as `'K': undefined`.
    const out = renderClient({ entries: new Map(), hoisted: [] }, ['GET /ghost'])
    expect(out).toContain('interface Api {}')
    expect(out).not.toContain('ghost')
  })

  it('says the file is not refreshed by kick dev', () => {
    // The one thing an adopter can be surprised by: a stale map after a save.
    const out = renderClient({ entries: new Map(), hoisted: [] }, [])
    expect(out).toContain('kick dev')
  })
})
