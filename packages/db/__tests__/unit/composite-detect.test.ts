/**
 * Unit-level coverage for `detectCompositeReferences` against a fake
 * query runner. Validates:
 *  - the SQL is parameterised with `(name, schema-or-null)`
 *  - the result mapper turns rows into `CompositeRef[]`
 *  - schema-qualified vs unqualified enum names route correctly
 *  - empty result yields an empty array
 *
 * Real-PG round-trip lives under __tests__/integration so this file
 * stays no-Docker.
 */

import { describe, it, expect } from 'vitest'

import {
  detectCompositeReferences,
  CompositeEnumReferenceError,
  type CompositeQueryRunner,
  type CompositeRef,
} from '@forinda/kickjs-db'

function fakeRunner(rows: Record<string, unknown>[]): {
  runner: CompositeQueryRunner
  calls: { sql: string; params: readonly unknown[] | undefined }[]
} {
  const calls: { sql: string; params: readonly unknown[] | undefined }[] = []
  return {
    runner: {
      async query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }> {
        calls.push({ sql, params })
        return { rows: rows as R[] }
      },
    },
    calls,
  }
}

describe('detectCompositeReferences', () => {
  it('returns an empty array when no composite references the enum', async () => {
    const { runner, calls } = fakeRunner([])
    const refs = await detectCompositeReferences(runner, 'user_status')

    expect(refs).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.params).toEqual(['user_status', null])
  })

  it('maps rows to CompositeRef shape with qualified type names', async () => {
    const { runner } = fakeRunner([
      {
        composite_schema: 'public',
        composite_name: 'address_t',
        attribute_name: 'status',
        enum_schema: 'public',
        enum_name: 'user_status',
      },
      {
        composite_schema: 'app',
        composite_name: 'profile_t',
        attribute_name: 'visibility',
        enum_schema: 'public',
        enum_name: 'user_status',
      },
    ])

    const refs = await detectCompositeReferences(runner, 'user_status')

    const expected: CompositeRef[] = [
      { composite: 'public.address_t', attribute: 'status', enum: 'public.user_status' },
      { composite: 'app.profile_t', attribute: 'visibility', enum: 'public.user_status' },
    ]
    expect(refs).toEqual(expected)
  })

  it('passes a non-null schema parameter when the enum name is qualified', async () => {
    const { runner, calls } = fakeRunner([])
    await detectCompositeReferences(runner, 'analytics.event_kind')

    expect(calls[0]!.params).toEqual(['event_kind', 'analytics'])
  })

  it('CompositeEnumReferenceError surfaces every reference in its message', () => {
    const refs: CompositeRef[] = [
      { composite: 'public.address_t', attribute: 'status', enum: 'public.user_status' },
      { composite: 'public.profile_t', attribute: 'tier', enum: 'public.user_status' },
    ]
    const err = new CompositeEnumReferenceError(refs)

    expect(err.code).toBe('composite_enum_reference')
    expect(err.refs).toEqual(refs)
    expect(err.message).toContain('public.address_t.status')
    expect(err.message).toContain('public.profile_t.tier')
    expect(err.message).toContain('rename-recreate')
  })
})
