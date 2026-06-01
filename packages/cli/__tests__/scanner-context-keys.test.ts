/**
 * Unit tests for `extractContextKeysFromSource` — the regex extraction
 * that feeds the `kick/context` typegen plugin (auto-populates the
 * `ContextKeys` registry from context-decorator `key:` literals).
 *
 * Covers every call shape: bare, generic, and the curried
 * `.withParams<P>()` form, for both `defineContextDecorator` and
 * `defineHttpContextDecorator`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Container } from '@forinda/kickjs'
import { extractContextKeysFromSource } from '../src/typegen/scanner'

// Project rule: every .test.ts resets DI state in beforeEach. This is a
// pure-function suite (no container use), but the reset keeps it
// consistent with the repo-wide isolation convention.
beforeEach(() => {
  Container.reset()
})

const FILE = '/proj/src/contributors/x.contributor.ts'
const keys = (source: string): string[] =>
  extractContextKeysFromSource(source, FILE, '/proj').map((k) => k.key)

describe('extractContextKeysFromSource', () => {
  it('extracts the key from a plain defineHttpContextDecorator call', () => {
    expect(
      keys(`export const Tenant = defineHttpContextDecorator({
        key: 'tenant',
        resolve: (ctx) => ({ id: ctx.req.headers['x-tenant-id'] }),
      })`),
    ).toEqual(['tenant'])
  })

  it('extracts from a bare defineContextDecorator call', () => {
    expect(keys(`const S = defineContextDecorator({ key: 'session', resolve: () => 1 })`)).toEqual([
      'session',
    ])
  })

  it('handles explicit generics', () => {
    expect(
      keys(
        `const T = defineHttpContextDecorator<'tenant', Record<string, never>>({ key: 'tenant', resolve: () => 1 })`,
      ),
    ).toEqual(['tenant'])
  })

  it('handles the curried .withParams<P>() form (http)', () => {
    expect(
      keys(`export const Project = defineHttpContextDecorator.withParams<{ depth: number }>()({
        key: 'project',
        paramDefaults: { depth: 0 },
        resolve: (ctx, _deps, params) => params.depth,
      })`),
    ).toEqual(['project'])
  })

  it('handles the curried .withParams<P>() form (bare)', () => {
    expect(
      keys(
        `const R = defineContextDecorator.withParams<{ scope: string }>()({ key: 'role', resolve: () => 1 })`,
      ),
    ).toEqual(['role'])
  })

  it('collects multiple decorators and dedupes repeated keys', () => {
    const out = keys(`
      const A = defineHttpContextDecorator({ key: 'tenant', resolve: () => 1 })
      const B = defineContextDecorator({ key: 'session', resolve: () => 1 })
      const C = defineHttpContextDecorator({ key: 'tenant', resolve: () => 2 })
    `)
    expect(out.toSorted()).toEqual(['session', 'tenant'])
  })

  it('ignores non-context define calls', () => {
    expect(
      keys(`const P = definePlugin({ name: 'X', build: () => ({}) })
            const Ad = defineAdapter({ name: 'Y', build: () => ({}) })`),
    ).toEqual([])
  })

  it('tolerates double/single/backtick quotes around the key', () => {
    expect(keys(`defineContextDecorator({ key: "a", resolve: () => 1 })`)).toEqual(['a'])
    expect(keys('defineContextDecorator({ key: `b`, resolve: () => 1 })')).toEqual(['b'])
  })
})
