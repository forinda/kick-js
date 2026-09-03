/**
 * Unit tests for route-flag discovery — the AST extraction that feeds the
 * `kick/route-flags` typegen plugin, which auto-populates `KickRouteFlags`
 * from `defineRouteFlag('name')` call sites.
 *
 * Cheaper than the context-key equivalent by construction: the name is a
 * positional string literal and there is no dependency graph, so the whole
 * contract is "name in, name plus optional value type out".
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Container } from '@forinda/kickjs'
import { extractFileAst } from '../src/typegen/extract-ast'
import { renderRouteFlags } from '../src/typegen/render/manifest'

beforeEach(() => {
  Container.reset()
})

const FILE = '/proj/src/flags.ts'
const flags = (source: string) =>
  extractFileAst(source, FILE, '/proj').routeFlags.map((f) => ({
    name: f.name,
    valueType: f.valueType,
  }))

describe('route-flag discovery', () => {
  it('finds a bare flag', () => {
    expect(flags(`export const Public = defineRouteFlag('auth.public')`)).toEqual([
      { name: 'auth.public', valueType: null },
    ])
  })

  it('captures an explicit value type verbatim', () => {
    expect(flags(`const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')`)).toEqual([
      { name: 'rate.limit', valueType: '{ rpm: number }' },
    ])
  })

  it('finds several in one file and ignores duplicates', () => {
    expect(
      flags(`
        export const A = defineRouteFlag('a')
        export const B = defineRouteFlag('b')
        const AAgain = defineRouteFlag('a')
      `),
    ).toEqual([
      { name: 'a', valueType: null },
      { name: 'b', valueType: null },
    ])
  })

  it('ignores a non-literal name — nothing to put in the registry', () => {
    expect(flags(`const F = defineRouteFlag(NAME)`)).toEqual([])
  })

  it('does not confuse a similarly named call', () => {
    expect(flags(`const X = defineRouteFlagLike('nope')`)).toEqual([])
  })
})

describe('renderRouteFlags', () => {
  const render = (source: string) =>
    renderRouteFlags(extractFileAst(source, FILE, '/proj').routeFlags)

  it('emits a declaration merge with the value types', () => {
    const out = render(`
      export const Public = defineRouteFlag('auth.public')
      export const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')
    `)
    expect(out).toContain("declare module '@forinda/kickjs'")
    expect(out).toContain('interface KickRouteFlags')
    expect(out).toContain('"auth.public": true')
    expect(out).toContain('"rate.limit": { rpm: number }')
  })

  it('degrades a named value type — it is not in scope in the generated file', () => {
    const out = render(`import type { RateLimit } from './types'
      const L = defineRouteFlag<RateLimit>('rate.limit')`)
    // Emitting `'rate.limit': RateLimit` would be `Cannot find name 'RateLimit'`
    // inside the declare-module block and break every consumer's typecheck.
    expect(out).not.toMatch(/'rate\.limit':\s*RateLimit/)
    expect(out).toContain('"rate.limit": unknown')
    expect(out).toContain('not in scope here')
  })

  it('keeps a self-contained type verbatim', () => {
    const out = render(`const L = defineRouteFlag<{ rpm: number; burst?: number }>('rate.limit')`)
    expect(out).toContain('"rate.limit": { rpm: number; burst?: number }')
  })

  it('keeps a self-contained type built from globals', () => {
    const out = render(`const W = defineRouteFlag<Record<string, number[]>>('w')`)
    expect(out).toContain('"w": Record<string, number[]>')
  })

  it('escapes a name containing a quote', () => {
    const out = render(`const A = defineRouteFlag("author's")`)
    // A hand-rolled quoted key would emit `'author's'` — a syntax error.
    expect(out).toContain('"author\'s": true')
  })

  it('sorts entries so the file does not churn between runs', () => {
    const out = render(`
      const B = defineRouteFlag('zeta')
      const A = defineRouteFlag('alpha')
    `)
    expect(out.indexOf('"alpha"')).toBeLessThan(out.indexOf('"zeta"'))
  })

  it('keeps a multiline named type on one line in the diagnostic', () => {
    const out = render(`import type { Big } from './types'
      const L = defineRouteFlag<
        Big
      >('big')`)
    // A raw line break would end the `//` comment and drop the rest into the
    // file as code.
    for (const line of out.split('\n')) {
      if (line.includes('not in scope here')) expect(line.trim().startsWith('//')).toBe(true)
    }
    expect(out).toContain('"big": unknown')
  })

  it('fails when one flag is declared with two different value types', () => {
    const a = extractFileAst(
      `const L = defineRouteFlag<{ rpm: number }>('rate.limit')`,
      '/proj/src/a.ts',
      '/proj',
    ).routeFlags
    const b = extractFileAst(
      `const L = defineRouteFlag<{ rps: number }>('rate.limit')`,
      '/proj/src/b.ts',
      '/proj',
    ).routeFlags
    expect(() => renderRouteFlags([...a, ...b])).toThrow(/two different value types/)
  })

  it('treats literal types differing only in whitespace as a conflict', () => {
    // `'a b'` and `'ab'` are different types to TypeScript — collapsing all
    // whitespace would let one silently win.
    const a = extractFileAst(
      `const L = defineRouteFlag<'a b'>('mode')`,
      '/proj/src/a.ts',
      '/proj',
    ).routeFlags
    const b = extractFileAst(
      `const L = defineRouteFlag<'ab'>('mode')`,
      '/proj/src/b.ts',
      '/proj',
    ).routeFlags
    expect(() => renderRouteFlags([...a, ...b])).toThrow(/two different value types/)
  })

  it('still ignores whitespace outside literals', () => {
    const a = extractFileAst(
      `const L = defineRouteFlag<{ mode: 'a b' }>('mode')`,
      '/proj/src/a.ts',
      '/proj',
    ).routeFlags
    const b = extractFileAst(
      `const L = defineRouteFlag<{mode:'a b'}>('mode')`,
      '/proj/src/b.ts',
      '/proj',
    ).routeFlags
    expect(renderRouteFlags([...a, ...b])).toContain('"mode"')
  })

  it('tolerates the same flag declared identically twice', () => {
    const decl = `const L = defineRouteFlag<{ rpm: number }>('rate.limit')`
    const a = extractFileAst(decl, '/proj/src/a.ts', '/proj').routeFlags
    const b = extractFileAst(
      `const L = defineRouteFlag<{rpm:number}>('rate.limit')`,
      '/proj/src/b.ts',
      '/proj',
    ).routeFlags
    // Same type, different spacing — one flag, no error.
    expect(renderRouteFlags([...a, ...b])).toContain('"rate.limit"')
  })

  it('emits a valid empty registry when a project declares none', () => {
    const out = renderRouteFlags([])
    expect(out).toContain('interface KickRouteFlags')
    expect(out).toContain('no route flags discovered yet')
  })
})
