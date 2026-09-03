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
    expect(out).toContain("'auth.public': true")
    expect(out).toContain("'rate.limit': { rpm: number }")
  })

  it('sorts entries so the file does not churn between runs', () => {
    const out = render(`
      const B = defineRouteFlag('zeta')
      const A = defineRouteFlag('alpha')
    `)
    expect(out.indexOf("'alpha'")).toBeLessThan(out.indexOf("'zeta'"))
  })

  it('emits a valid empty registry when a project declares none', () => {
    const out = renderRouteFlags([])
    expect(out).toContain('interface KickRouteFlags')
    expect(out).toContain('no route flags discovered yet')
  })
})
