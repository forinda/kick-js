import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  parseQuery,
  parseFilters,
  parseSort,
  parsePagination,
  parseSearchQuery,
  setQueryParsingDefaults,
  getQueryParsingDefaults,
  resetQueryParsingDefaults,
} from '../src/http/query/parse-query'

// Any test that mutates the module-level defaults restores them here so
// global state never leaks between tests, even on assertion failure.
afterEach(() => resetQueryParsingDefaults())

describe('parseFilters — onReject', () => {
  it('reports a filter dropped for an unknown field', () => {
    const onReject = vi.fn()
    const out = parseFilters(['status:eq:open', 'secret:eq:x'], ['status'], { onReject })
    expect(out).toHaveLength(1)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith({
      kind: 'filter',
      field: 'secret',
      reason: 'field-not-allowed',
    })
  })

  it('reports a filter dropped for an unknown operator', () => {
    const onReject = vi.fn()
    parseFilters(['status:bogus:open'], ['status'], { onReject })
    expect(onReject).toHaveBeenCalledWith({
      kind: 'filter',
      field: 'status',
      reason: 'unknown-operator',
    })
  })

  it('stays silent when every filter is accepted', () => {
    const onReject = vi.fn()
    parseFilters(['status:eq:open'], ['status'], { onReject })
    expect(onReject).not.toHaveBeenCalled()
  })
})

describe('parseSort — onReject', () => {
  it('reports a sort dropped for an unknown field', () => {
    const onReject = vi.fn()
    const out = parseSort(['name:asc', 'secret:desc'], ['name'], { onReject })
    expect(out).toHaveLength(1)
    expect(onReject).toHaveBeenCalledWith({
      kind: 'sort',
      field: 'secret',
      reason: 'field-not-allowed',
    })
  })
})

describe('parsePagination — configurable limits', () => {
  it('clamps to a per-call maxLimit', () => {
    expect(parsePagination({ page: '1', limit: '500' }, { maxLimit: 50 }).limit).toBe(50)
  })

  it('uses a per-call defaultLimit when limit is absent', () => {
    expect(parsePagination({ page: '1' }, { defaultLimit: 25 }).limit).toBe(25)
  })

  it('falls back to the global defaults', () => {
    expect(parsePagination({ page: '1', limit: '500' }).limit).toBe(100)
    expect(parsePagination({ page: '1' }).limit).toBe(20)
  })
})

describe('parseSearchQuery — truncation reporting', () => {
  it('truncates to maxSearchLength and reports it', () => {
    const onReject = vi.fn()
    const long = 'a'.repeat(300)
    const out = parseSearchQuery(long, { maxSearchLength: 50, onReject })
    expect(out).toHaveLength(50)
    expect(onReject).toHaveBeenCalledWith({
      kind: 'search',
      field: 'q',
      reason: 'truncated',
    })
  })

  it('does not report when within length', () => {
    const onReject = vi.fn()
    parseSearchQuery('short', { maxSearchLength: 50, onReject })
    expect(onReject).not.toHaveBeenCalled()
  })
})

describe('parseQuery — options threading', () => {
  it('threads onReject + limits to every sub-parser', () => {
    const onReject = vi.fn()
    const parsed = parseQuery(
      { filter: 'bad:eq:x', sort: 'bad:asc', q: 'y'.repeat(20), page: '1', limit: '999' },
      { filterable: ['ok'], sortable: ['ok'] },
      { maxLimit: 10, maxSearchLength: 5, onReject },
    )
    expect(parsed.pagination.limit).toBe(10)
    expect(parsed.search).toHaveLength(5)
    const reasons = onReject.mock.calls.map((c) => `${c[0].kind}:${c[0].reason}`)
    expect(reasons).toEqual(
      expect.arrayContaining([
        'filter:field-not-allowed',
        'sort:field-not-allowed',
        'search:truncated',
      ]),
    )
  })

  it('is backward compatible with the 2-arg form', () => {
    const parsed = parseQuery({ filter: 'status:eq:open' }, { filterable: ['status'] })
    expect(parsed.filters).toEqual([{ field: 'status', operator: 'eq', value: 'open' }])
  })
})

describe('setQueryParsingDefaults', () => {
  it('overrides the global maxLimit (afterEach resets)', () => {
    const prev = getQueryParsingDefaults()
    setQueryParsingDefaults({ maxLimit: 5 })
    expect(parsePagination({ page: '1', limit: '999' }).limit).toBe(5)
    // No manual restore — the afterEach reset guarantees cleanup even if
    // this assertion throws. Verify the helper round-trips the original.
    resetQueryParsingDefaults()
    expect(parsePagination({ page: '1', limit: '999' }).limit).toBe(prev.maxLimit)
  })

  it('resetQueryParsingDefaults restores every field', () => {
    setQueryParsingDefaults({ maxLimit: 1, defaultLimit: 1, maxSearchLength: 1 })
    resetQueryParsingDefaults()
    expect(getQueryParsingDefaults()).toMatchObject({
      maxLimit: 100,
      defaultLimit: 20,
      maxSearchLength: 200,
    })
  })
})
