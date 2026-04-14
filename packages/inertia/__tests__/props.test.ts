import { describe, it, expect } from 'vitest'
import { defer, optional, always, merge } from '../src/props'
import { DEFERRED_PROP, OPTIONAL_PROP, ALWAYS_PROP, TO_BE_MERGED } from '../src/symbols'

describe('defer()', () => {
  it('brands a function with DEFERRED_PROP', () => {
    const fn = () => 'data'
    const result = defer(fn)
    expect(result[DEFERRED_PROP]).toBe(true)
  })

  it('preserves the original function', async () => {
    const fn = () => 'data'
    const result = defer(fn)
    expect(await result()).toBe('data')
  })

  it('stores the group name when provided', () => {
    const fn = () => 'data'
    const result = defer(fn, 'metrics')
    expect(result._group).toBe('metrics')
  })

  it('defaults group to undefined when not provided', () => {
    const fn = () => 'data'
    const result = defer(fn)
    expect(result._group).toBeUndefined()
  })
})

describe('optional()', () => {
  it('brands a function with OPTIONAL_PROP', () => {
    const fn = () => 'data'
    const result = optional(fn)
    expect(result[OPTIONAL_PROP]).toBe(true)
  })

  it('preserves the original function', async () => {
    const fn = () => 42
    const result = optional(fn)
    expect(await result()).toBe(42)
  })
})

describe('always()', () => {
  it('brands a value with ALWAYS_PROP', () => {
    const result = always('admin')
    expect(result[ALWAYS_PROP]).toBe(true)
  })

  it('stores the value', () => {
    const result = always({ role: 'admin' })
    expect(result.value).toEqual({ role: 'admin' })
  })
})

describe('merge()', () => {
  it('brands a value with TO_BE_MERGED', () => {
    const result = merge([1, 2, 3])
    expect(result[TO_BE_MERGED]).toBe(true)
  })

  it('stores the value', () => {
    const items = [1, 2, 3]
    const result = merge(items)
    expect(result.value).toBe(items)
  })
})
