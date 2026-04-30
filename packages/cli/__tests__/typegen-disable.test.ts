import { describe, it, expect } from 'vitest'

import { applyDisableFilter } from '../src/typegen/disable-filter'
import type { TypegenPlugin } from '../src/typegen/plugin'

const tg = (id: string): TypegenPlugin => ({
  id,
  inputs: [],
  async generate() {
    return null
  },
})

describe('applyDisableFilter (typegen.disable)', () => {
  it('separates enabled vs skipped by id', () => {
    const r = applyDisableFilter([tg('kick/db'), tg('kick/assets'), tg('demo/x')], ['kick/db'])
    expect(r.enabled.map((t) => t.id)).toEqual(['kick/assets', 'demo/x'])
    expect(r.skipped.map((t) => t.id)).toEqual(['kick/db'])
    expect(r.unknown).toEqual([])
  })

  it('flags unrecognised disable ids as unknown', () => {
    const r = applyDisableFilter([tg('kick/db')], ['kick/db', 'kicc/db', 'foo/bar'])
    expect(r.skipped.map((t) => t.id)).toEqual(['kick/db'])
    expect(r.unknown.toSorted()).toEqual(['foo/bar', 'kicc/db'])
  })

  it('empty disable list = everything enabled, nothing unknown', () => {
    const r = applyDisableFilter([tg('kick/db'), tg('kick/assets')], [])
    expect(r.enabled.map((t) => t.id)).toEqual(['kick/db', 'kick/assets'])
    expect(r.skipped).toEqual([])
    expect(r.unknown).toEqual([])
  })

  it('disabling everything leaves enabled empty', () => {
    const r = applyDisableFilter([tg('kick/db'), tg('kick/assets')], ['kick/db', 'kick/assets'])
    expect(r.enabled).toEqual([])
    expect(r.skipped.map((t) => t.id)).toEqual(['kick/db', 'kick/assets'])
  })
})
