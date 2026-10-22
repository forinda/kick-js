import { describe, expect, it } from 'vitest'
import { flagEntries, metaSummary, routeMatches, splitList } from '../spa/src/lib/route-meta'
import type { RouteEntry } from '../spa/src/lib/store'

const route = (over: Partial<RouteEntry> = {}): RouteEntry => ({
  method: 'POST',
  path: '/seller/:merchantId/branches',
  controller: 'BranchesController',
  handler: 'create',
  middleware: ['authGuard'],
  ...over,
})

const can = { permissions: ['merchant:branch:manage'], merchantParam: 'merchantId' }
const user = {
  key: 'user',
  source: 'method',
  dependsOn: [],
  beforeValidation: false,
  overrides: [],
}

describe('route meta', () => {
  it('summarises flags and contributors as counts', () => {
    expect(metaSummary(route())).toBe('')
    expect(metaSummary(route({ flags: { 'auth.can': can } }))).toBe('1 flag')
    expect(metaSummary(route({ flags: { 'auth.public': true, 'auth.skip-terms': true } }))).toBe(
      '2 flags',
    )
    expect(metaSummary(route({ contributors: [user] }))).toBe('ctx 1')
    expect(metaSummary(route({ flags: { 'auth.can': can }, contributors: [user] }))).toBe(
      '1 flag · ctx 1',
    )
  })

  it('lists flags with formatted values; a true flag has none', () => {
    expect(flagEntries({ 'auth.public': true, 'auth.can': can, limit: 5 })).toEqual([
      { name: 'auth.public' },
      { name: 'auth.can', value: JSON.stringify(can, null, 2), raw: can },
      { name: 'limit', value: '5', raw: 5 },
    ])
    expect(flagEntries(undefined)).toEqual([])
  })

  it('search matches path, controller, handler, flag names and contributor keys', () => {
    const r = route({ flags: { 'auth.can': can }, contributors: [user] })
    for (const q of ['branches', 'branchescontroller', 'create', 'auth.can', 'AUTH.CAN', 'user']) {
      expect(routeMatches(r, q.toLowerCase()), q).toBe(true)
    }
    expect(routeMatches(r, 'auth.public')).toBe(false)
    expect(routeMatches(r, '')).toBe(true)
  })

  it('splits a long list into what shows and how many are folded', () => {
    const perms = Array.from({ length: 18 }, (_, i) => `p:${i}`)
    expect(splitList(perms, 8)).toEqual({ shown: perms.slice(0, 8), more: 10 })
    expect(splitList(perms.slice(0, 8), 8)).toEqual({ shown: perms.slice(0, 8), more: 0 })
    expect(splitList(perms, 8, true)).toEqual({ shown: perms, more: 0 })
  })
})
