import { describe, it, expect } from 'vitest'
import {
  parseQuery,
  parseFilters,
  parseSort,
  parsePagination,
  parseSearchQuery,
  buildQueryParams,
} from '@kickjs/http'

describe('Query Parser', () => {
  // ── parseFilters ──────────────────────────────────────────────────

  describe('parseFilters', () => {
    it('parses a single filter string', () => {
      const result = parseFilters('status:eq:active')
      expect(result).toEqual([{ field: 'status', operator: 'eq', value: 'active' }])
    })

    it('parses multiple filter strings (array)', () => {
      const result = parseFilters(['status:eq:active', 'priority:gte:3'])
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ field: 'status', operator: 'eq', value: 'active' })
      expect(result[1]).toEqual({ field: 'priority', operator: 'gte', value: '3' })
    })

    it('supports all operators', () => {
      const ops = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains', 'starts', 'ends']
      for (const op of ops) {
        const result = parseFilters(`field:${op}:value`)
        expect(result).toHaveLength(1)
        expect(result[0].operator).toBe(op)
      }
    })

    it('rejects invalid operators', () => {
      const result = parseFilters('field:like:value')
      expect(result).toHaveLength(0)
    })

    it('preserves colons in values (e.g. timestamps)', () => {
      const result = parseFilters('time:eq:10:30:00')
      expect(result[0].value).toBe('10:30:00')
    })

    it('respects allowedFields whitelist', () => {
      const result = parseFilters(
        ['status:eq:active', 'secret:eq:hidden'],
        ['status'],
      )
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe('status')
    })

    it('returns empty for undefined input', () => {
      expect(parseFilters(undefined)).toEqual([])
    })

    it('skips entries with missing parts', () => {
      expect(parseFilters('field')).toEqual([])         // no operator/value
      expect(parseFilters('field:eq')).toEqual([])      // no value
      expect(parseFilters(':eq:value')).toEqual([])     // no field
      expect(parseFilters('field:eq:')).toEqual([])     // empty value
    })

    it('handles in operator with comma values', () => {
      const result = parseFilters('grade:in:1,2,3')
      expect(result[0].value).toBe('1,2,3')
    })

    it('handles between operator', () => {
      const result = parseFilters('age:between:18,65')
      expect(result[0].value).toBe('18,65')
    })
  })

  // ── parseSort ─────────────────────────────────────────────────────

  describe('parseSort', () => {
    it('parses a single sort string', () => {
      const result = parseSort('name:asc')
      expect(result).toEqual([{ field: 'name', direction: 'asc' }])
    })

    it('parses multiple sort strings', () => {
      const result = parseSort(['name:asc', 'createdAt:desc'])
      expect(result).toHaveLength(2)
      expect(result[1].direction).toBe('desc')
    })

    it('direction is case-insensitive', () => {
      const result = parseSort('name:ASC')
      expect(result[0].direction).toBe('asc')
    })

    it('rejects invalid direction', () => {
      expect(parseSort('name:up')).toEqual([])
    })

    it('respects allowedFields', () => {
      const result = parseSort(['name:asc', 'secret:desc'], ['name'])
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe('name')
    })

    it('returns empty for undefined', () => {
      expect(parseSort(undefined)).toEqual([])
    })

    it('handles field names with no direction', () => {
      expect(parseSort('name')).toEqual([]) // no colon
    })
  })

  // ── parsePagination ───────────────────────────────────────────────

  describe('parsePagination', () => {
    it('returns defaults when no params', () => {
      const result = parsePagination({})
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
    })

    it('parses string page and limit', () => {
      const result = parsePagination({ page: '3', limit: '50' })
      expect(result.page).toBe(3)
      expect(result.limit).toBe(50)
      expect(result.offset).toBe(100) // (3-1)*50
    })

    it('clamps page to minimum 1', () => {
      const result = parsePagination({ page: '0' })
      expect(result.page).toBe(1)
    })

    it('clamps limit to maximum 100', () => {
      const result = parsePagination({ limit: '500' })
      expect(result.limit).toBe(100)
    })

    it('handles NaN gracefully', () => {
      const result = parsePagination({ page: 'abc', limit: 'xyz' })
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
    })

    it('accepts number inputs directly', () => {
      const result = parsePagination({ page: 2, limit: 10 })
      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(result.offset).toBe(10)
    })
  })

  // ── parseSearchQuery ──────────────────────────────────────────────

  describe('parseSearchQuery', () => {
    it('trims and returns search string', () => {
      expect(parseSearchQuery('  hello world  ')).toBe('hello world')
    })

    it('truncates to 200 characters', () => {
      const long = 'a'.repeat(300)
      expect(parseSearchQuery(long).length).toBe(200)
    })

    it('returns empty string for undefined', () => {
      expect(parseSearchQuery(undefined)).toBe('')
    })
  })

  // ── parseQuery (combined) ─────────────────────────────────────────

  describe('parseQuery', () => {
    it('parses a full query object', () => {
      const result = parseQuery({
        filter: ['status:eq:active', 'priority:gte:3'],
        sort: 'createdAt:desc',
        page: '2',
        limit: '25',
        q: 'urgent',
      })

      expect(result.filters).toHaveLength(2)
      expect(result.sort).toHaveLength(1)
      expect(result.pagination.page).toBe(2)
      expect(result.pagination.limit).toBe(25)
      expect(result.search).toBe('urgent')
    })

    it('applies fieldConfig restrictions', () => {
      const result = parseQuery(
        {
          filter: ['status:eq:active', 'secret:eq:hidden'],
          sort: ['name:asc', 'secret:desc'],
        },
        {
          filterable: ['status'],
          sortable: ['name'],
        },
      )

      expect(result.filters).toHaveLength(1)
      expect(result.sort).toHaveLength(1)
    })

    it('handles empty query object', () => {
      const result = parseQuery({})
      expect(result.filters).toEqual([])
      expect(result.sort).toEqual([])
      expect(result.pagination.page).toBe(1)
      expect(result.search).toBe('')
    })
  })

  // ── buildQueryParams (reverse) ────────────────────────────────────

  describe('buildQueryParams', () => {
    it('converts ParsedQuery back to query params', () => {
      const params = buildQueryParams({
        filters: [{ field: 'status', operator: 'eq', value: 'active' }],
        sort: [{ field: 'name', direction: 'asc' }],
        pagination: { page: 2, limit: 25, offset: 25 },
        search: 'hello',
      })

      expect(params.filter).toEqual(['status:eq:active'])
      expect(params.sort).toEqual(['name:asc'])
      expect(params.page).toBe(2)
      expect(params.limit).toBe(25)
      expect(params.q).toBe('hello')
    })

    it('omits empty sections', () => {
      const params = buildQueryParams({
        filters: [],
        sort: [],
        search: '',
      })

      expect(params.filter).toBeUndefined()
      expect(params.sort).toBeUndefined()
      expect(params.q).toBeUndefined()
    })
  })
})
