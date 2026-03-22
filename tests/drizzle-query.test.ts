import { describe, it, expect, beforeEach } from 'vitest'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import type { ParsedQuery } from '@forinda/kickjs-http'

/**
 * Mock Drizzle Column object with dataType for type coercion tests.
 * Real Drizzle columns have `dataType`, `name`, `columnType`, etc.
 */
function mockColumn(name: string, dataType: string) {
  return { name, dataType, _: { dataType } }
}

/** Mock Drizzle operators that record calls for assertion */
function createMockOps() {
  return {
    eq: (col: any, val: any) => ({ op: 'eq', col, val }),
    ne: (col: any, val: any) => ({ op: 'ne', col, val }),
    gt: (col: any, val: any) => ({ op: 'gt', col, val }),
    gte: (col: any, val: any) => ({ op: 'gte', col, val }),
    lt: (col: any, val: any) => ({ op: 'lt', col, val }),
    lte: (col: any, val: any) => ({ op: 'lte', col, val }),
    ilike: (col: any, val: string) => ({ op: 'ilike', col, val }),
    inArray: (col: any, vals: any[]) => ({ op: 'inArray', col, vals }),
    between: (col: any, min: any, max: any) => ({ op: 'between', col, min, max }),
    and: (...conditions: any[]) => ({ op: 'and', conditions: conditions.filter(Boolean) }),
    or: (...conditions: any[]) => ({ op: 'or', conditions: conditions.filter(Boolean) }),
    asc: (col: any) => ({ op: 'asc', col }),
    desc: (col: any) => ({ op: 'desc', col }),
  }
}

function baseParsed(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    filters: [],
    sort: [],
    search: '',
    pagination: { page: 1, limit: 20, offset: 0 },
    ...overrides,
  }
}

describe('DrizzleQueryAdapter', () => {
  let adapter: DrizzleQueryAdapter
  let ops: ReturnType<typeof createMockOps>

  beforeEach(() => {
    ops = createMockOps()
    adapter = new DrizzleQueryAdapter(ops)
  })

  describe('build() — string-based (legacy)', () => {
    const table = {
      name: mockColumn('name', 'string'),
      email: mockColumn('email', 'string'),
      age: mockColumn('age', 'number'),
      isActive: mockColumn('isActive', 'boolean'),
    }

    it('returns pagination defaults when no filters/sort', () => {
      const result = adapter.build(baseParsed(), { table })
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
      expect(result.where).toBeUndefined()
      expect(result.orderBy).toEqual([])
    })

    it('builds eq filter', () => {
      const result = adapter.build(
        baseParsed({ filters: [{ field: 'name', operator: 'eq', value: 'Alice' }] }),
        { table },
      )
      expect(result.where).toEqual({ op: 'eq', col: table.name, val: 'Alice' })
    })

    it('builds search across multiple columns', () => {
      const result = adapter.build(baseParsed({ search: 'alice' }), {
        table,
        searchColumns: ['name', 'email'],
      })
      expect(result.where.op).toBe('or')
      expect(result.where.conditions).toHaveLength(2)
      expect(result.where.conditions[0]).toEqual({
        op: 'ilike',
        col: table.name,
        val: '%alice%',
      })
    })

    it('builds sort with asc and desc', () => {
      const result = adapter.build(
        baseParsed({
          sort: [
            { field: 'name', direction: 'asc' },
            { field: 'age', direction: 'desc' },
          ],
        }),
        { table },
      )
      expect(result.orderBy).toHaveLength(2)
      expect(result.orderBy[0]).toEqual({ op: 'asc', col: table.name })
      expect(result.orderBy[1]).toEqual({ op: 'desc', col: table.age })
    })

    it('ignores unknown columns in filters', () => {
      const result = adapter.build(
        baseParsed({ filters: [{ field: 'unknown', operator: 'eq', value: 'x' }] }),
        { table },
      )
      expect(result.where).toBeUndefined()
    })

    it('coerces boolean and number values', () => {
      const result = adapter.build(
        baseParsed({
          filters: [
            { field: 'isActive', operator: 'eq', value: 'true' },
            { field: 'age', operator: 'gt', value: '25' },
          ],
        }),
        { table },
      )
      // Two filters → and()
      expect(result.where.op).toBe('and')
      expect(result.where.conditions[0].val).toBe(true)
      expect(result.where.conditions[1].val).toBe(25)
    })

    it('handles in operator with comma-separated values', () => {
      const result = adapter.build(
        baseParsed({ filters: [{ field: 'name', operator: 'in', value: 'Alice,Bob,Carol' }] }),
        { table },
      )
      expect(result.where.op).toBe('inArray')
      expect(result.where.vals).toEqual(['Alice', 'Bob', 'Carol'])
    })

    it('handles between operator', () => {
      const result = adapter.build(
        baseParsed({ filters: [{ field: 'age', operator: 'between', value: '18,65' }] }),
        { table },
      )
      // Legacy build uses and(gte, lte)
      expect(result.where.op).toBe('and')
    })
  })

  describe('buildFromColumns() — Column-based (recommended)', () => {
    const statusCol = mockColumn('status', 'string')
    const isActiveCol = mockColumn('is_active', 'boolean')
    const ageCol = mockColumn('age', 'number')
    const createdAtCol = mockColumn('created_at', 'date')
    const nameCol = mockColumn('name', 'string')
    const emailCol = mockColumn('email', 'string')

    const config = {
      columns: {
        status: statusCol,
        isActive: isActiveCol,
        age: ageCol,
        createdAt: createdAtCol,
      },
      sortable: {
        name: nameCol,
        createdAt: createdAtCol,
      },
      searchColumns: [nameCol, emailCol],
    }

    it('returns pagination defaults when no filters/sort', () => {
      const result = adapter.buildFromColumns(baseParsed(), config)
      expect(result.limit).toBe(20)
      expect(result.offset).toBe(0)
      expect(result.where).toBeUndefined()
      expect(result.orderBy).toEqual([])
    })

    it('builds filter using Column objects', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'status', operator: 'eq', value: 'active' }] }),
        config,
      )
      expect(result.where).toEqual({ op: 'eq', col: statusCol, val: 'active' })
    })

    it('coerces boolean based on column.dataType', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'isActive', operator: 'eq', value: 'true' }] }),
        config,
      )
      expect(result.where.val).toBe(true)
    })

    it('coerces number based on column.dataType', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'age', operator: 'gt', value: '25' }] }),
        config,
      )
      expect(result.where.val).toBe(25)
    })

    it('coerces date based on column.dataType', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'createdAt', operator: 'gte', value: '2024-01-15' }] }),
        config,
      )
      expect(result.where.val).toBeInstanceOf(Date)
      expect((result.where.val as Date).toISOString()).toContain('2024-01-15')
    })

    it('uses native between operator when available', () => {
      const result = adapter.buildFromColumns(
        baseParsed({
          filters: [{ field: 'age', operator: 'between', value: '18,65' }],
        }),
        config,
      )
      expect(result.where.op).toBe('between')
      expect(result.where.min).toBe(18)
      expect(result.where.max).toBe(65)
    })

    it('falls back to and(gte, lte) for between when ops.between is not provided', () => {
      const opsWithoutBetween = { ...ops, between: undefined }
      const adapterNoBetween = new DrizzleQueryAdapter(opsWithoutBetween)

      const result = adapterNoBetween.buildFromColumns(
        baseParsed({
          filters: [{ field: 'age', operator: 'between', value: '18,65' }],
        }),
        config,
      )
      expect(result.where.op).toBe('and')
    })

    it('prepends baseCondition to all queries', () => {
      const baseCondition = { op: 'eq', col: 'tenantId', val: 'tenant_123' }
      const result = adapter.buildFromColumns(baseParsed(), { ...config, baseCondition })
      expect(result.where).toEqual(baseCondition)
    })

    it('combines baseCondition with filters', () => {
      const baseCondition = { op: 'eq', col: 'tenantId', val: 'tenant_123' }
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'status', operator: 'eq', value: 'active' }] }),
        { ...config, baseCondition },
      )
      expect(result.where.op).toBe('and')
      expect(result.where.conditions[0]).toEqual(baseCondition)
      expect(result.where.conditions[1].op).toBe('eq')
    })

    it('uses searchColumns as Column objects directly', () => {
      const result = adapter.buildFromColumns(baseParsed({ search: 'alice' }), config)
      expect(result.where.op).toBe('or')
      expect(result.where.conditions).toHaveLength(2)
      expect(result.where.conditions[0].col).toBe(nameCol)
      expect(result.where.conditions[1].col).toBe(emailCol)
    })

    it('uses sortable map for sorting', () => {
      const result = adapter.buildFromColumns(
        baseParsed({
          sort: [
            { field: 'name', direction: 'asc' },
            { field: 'createdAt', direction: 'desc' },
          ],
        }),
        config,
      )
      expect(result.orderBy).toHaveLength(2)
      expect(result.orderBy[0]).toEqual({ op: 'asc', col: nameCol })
      expect(result.orderBy[1]).toEqual({ op: 'desc', col: createdAtCol })
    })

    it('falls back to columns map for sorting when sortable not provided', () => {
      const { sortable, ...configNoSortable } = config
      const result = adapter.buildFromColumns(
        baseParsed({ sort: [{ field: 'status', direction: 'asc' }] }),
        configNoSortable,
      )
      expect(result.orderBy).toHaveLength(1)
      expect(result.orderBy[0]).toEqual({ op: 'asc', col: statusCol })
    })

    it('ignores unknown columns in filters', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'unknown', operator: 'eq', value: 'x' }] }),
        config,
      )
      expect(result.where).toBeUndefined()
    })

    it('handles all string operators (contains, starts, ends)', () => {
      const contains = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'status', operator: 'contains', value: 'act' }] }),
        config,
      )
      expect(contains.where).toEqual({ op: 'ilike', col: statusCol, val: '%act%' })

      const starts = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'status', operator: 'starts', value: 'act' }] }),
        config,
      )
      expect(starts.where).toEqual({ op: 'ilike', col: statusCol, val: 'act%' })

      const ends = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'status', operator: 'ends', value: 'ive' }] }),
        config,
      )
      expect(ends.where).toEqual({ op: 'ilike', col: statusCol, val: '%ive' })
    })

    it('handles in operator with type coercion', () => {
      const result = adapter.buildFromColumns(
        baseParsed({ filters: [{ field: 'age', operator: 'in', value: '18,25,30' }] }),
        config,
      )
      expect(result.where.op).toBe('inArray')
      expect(result.where.vals).toEqual([18, 25, 30])
    })
  })
})
