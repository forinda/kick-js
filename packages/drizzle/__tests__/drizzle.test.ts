import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DrizzleAdapter,
  DrizzleQueryAdapter,
  toQueryFieldConfig,
  DRIZZLE_DB,
  type DrizzleOps,
  type DrizzleColumnQueryConfig,
  type DrizzleQueryConfig,
} from '@forinda/kickjs-drizzle'
import { Container } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a minimal ParsedQuery with sensible defaults */
function makeParsed(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    filters: [],
    sort: [],
    pagination: { page: 1, limit: 20, offset: 0 },
    search: '',
    ...overrides,
  }
}

/** Create a mock Drizzle table where each key is a mock column object */
function mockTable(...columns: string[]): Record<string, any> {
  const table: Record<string, any> = {}
  for (const col of columns) {
    table[col] = { name: col, __column: true }
  }
  return table
}

/** Create a mock Drizzle column with a dataType for column-based config */
function mockColumn(name: string, dataType?: string) {
  return { name, dataType, __column: true }
}

/** Build a set of mock DrizzleOps where every function is a vi.fn() that returns a tag */
function createMockOps(): DrizzleOps {
  return {
    eq: vi.fn((col, val) => ({ op: 'eq', col, val })),
    ne: vi.fn((col, val) => ({ op: 'ne', col, val })),
    gt: vi.fn((col, val) => ({ op: 'gt', col, val })),
    gte: vi.fn((col, val) => ({ op: 'gte', col, val })),
    lt: vi.fn((col, val) => ({ op: 'lt', col, val })),
    lte: vi.fn((col, val) => ({ op: 'lte', col, val })),
    ilike: vi.fn((col, val) => ({ op: 'ilike', col, val })),
    inArray: vi.fn((col, vals) => ({ op: 'inArray', col, vals })),
    between: vi.fn((col, min, max) => ({ op: 'between', col, min, max })),
    and: vi.fn((...conds) => ({ op: 'and', conds })),
    or: vi.fn((...conds) => ({ op: 'or', conds })),
    asc: vi.fn((col) => ({ op: 'asc', col })),
    desc: vi.fn((col) => ({ op: 'desc', col })),
  }
}

// ── DrizzleAdapter ───────────────────────────────────────────────────────

describe('DrizzleAdapter', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('should have the name "DrizzleAdapter"', () => {
    const adapter = DrizzleAdapter({ db: {} })
    expect(adapter.name).toBe('DrizzleAdapter')
  })

  it('should register the db instance in the DI container via beforeStart', () => {
    const fakeDb = { query: vi.fn() }
    const adapter = DrizzleAdapter({ db: fakeDb })

    const container = Container.getInstance()
    adapter.beforeStart({ container } as any)

    const resolved = container.resolve(DRIZZLE_DB)
    expect(resolved).toBe(fakeDb)
  })

  it('should call onShutdown when shutdown is invoked', async () => {
    const onShutdown = vi.fn()
    const adapter = DrizzleAdapter({ db: {}, onShutdown })

    await adapter.shutdown()

    expect(onShutdown).toHaveBeenCalledOnce()
  })

  it('should not throw when shutdown is called without onShutdown', async () => {
    const adapter = DrizzleAdapter({ db: {} })
    await expect(adapter.shutdown()).resolves.toBeUndefined()
  })

  it('should await an async onShutdown', async () => {
    let closed = false
    const adapter = DrizzleAdapter({
      db: {},
      onShutdown: async () => {
        closed = true
      },
    })

    await adapter.shutdown()
    expect(closed).toBe(true)
  })
})

// ── DrizzleQueryAdapter.build() (string-based) ──────────────────────────

describe('DrizzleQueryAdapter.build()', () => {
  let ops: DrizzleOps
  let adapter: DrizzleQueryAdapter

  beforeEach(() => {
    ops = createMockOps()
    adapter = new DrizzleQueryAdapter(ops)
  })

  it('should return default pagination with no filters or sort', () => {
    const result = adapter.build(makeParsed({ pagination: { page: 2, limit: 10, offset: 10 } }))

    expect(result.limit).toBe(10)
    expect(result.offset).toBe(10)
    expect(result.orderBy).toEqual([])
    expect(result.where).toBeUndefined()
  })

  // ── Filter operators ──────────────────────────────────────────────────

  it('should build an eq filter', () => {
    const table = mockTable('status')
    const parsed = makeParsed({
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    })

    adapter.build(parsed, { table })

    expect(ops.eq).toHaveBeenCalledWith(table.status, 'active')
  })

  it('should build a neq filter', () => {
    const table = mockTable('status')
    const parsed = makeParsed({
      filters: [{ field: 'status', operator: 'neq', value: 'archived' }],
    })

    adapter.build(parsed, { table })

    expect(ops.ne).toHaveBeenCalledWith(table.status, 'archived')
  })

  it('should build gt / gte / lt / lte filters', () => {
    const table = mockTable('age')
    const parsed = makeParsed({
      filters: [
        { field: 'age', operator: 'gt', value: '18' },
        { field: 'age', operator: 'gte', value: '21' },
        { field: 'age', operator: 'lt', value: '65' },
        { field: 'age', operator: 'lte', value: '100' },
      ],
    })

    adapter.build(parsed, { table })

    expect(ops.gt).toHaveBeenCalledWith(table.age, 18)
    expect(ops.gte).toHaveBeenCalledWith(table.age, 21)
    expect(ops.lt).toHaveBeenCalledWith(table.age, 65)
    expect(ops.lte).toHaveBeenCalledWith(table.age, 100)
  })

  it('should build a contains filter using ilike', () => {
    const table = mockTable('name')
    const parsed = makeParsed({
      filters: [{ field: 'name', operator: 'contains', value: 'john' }],
    })

    adapter.build(parsed, { table })

    expect(ops.ilike).toHaveBeenCalledWith(table.name, '%john%')
  })

  it('should build a starts filter using ilike', () => {
    const table = mockTable('name')
    const parsed = makeParsed({
      filters: [{ field: 'name', operator: 'starts', value: 'J' }],
    })

    adapter.build(parsed, { table })

    expect(ops.ilike).toHaveBeenCalledWith(table.name, 'J%')
  })

  it('should build an ends filter using ilike', () => {
    const table = mockTable('name')
    const parsed = makeParsed({
      filters: [{ field: 'name', operator: 'ends', value: 'son' }],
    })

    adapter.build(parsed, { table })

    expect(ops.ilike).toHaveBeenCalledWith(table.name, '%son')
  })

  it('should build an in filter using inArray', () => {
    const table = mockTable('status')
    const parsed = makeParsed({
      filters: [{ field: 'status', operator: 'in', value: 'active,pending,closed' }],
    })

    adapter.build(parsed, { table })

    expect(ops.inArray).toHaveBeenCalledWith(table.status, ['active', 'pending', 'closed'])
  })

  it('should build a between filter using gte + lte', () => {
    const table = mockTable('price')
    const parsed = makeParsed({
      filters: [{ field: 'price', operator: 'between', value: '10,50' }],
    })

    adapter.build(parsed, { table })

    expect(ops.gte).toHaveBeenCalledWith(table.price, 10)
    expect(ops.lte).toHaveBeenCalledWith(table.price, 50)
  })

  it('should coerce "true" / "false" to booleans', () => {
    const table = mockTable('isActive')
    const parsed = makeParsed({
      filters: [{ field: 'isActive', operator: 'eq', value: 'true' }],
    })

    adapter.build(parsed, { table })

    expect(ops.eq).toHaveBeenCalledWith(table.isActive, true)
  })

  it('should coerce numeric strings to numbers', () => {
    const table = mockTable('count')
    const parsed = makeParsed({
      filters: [{ field: 'count', operator: 'eq', value: '42' }],
    })

    adapter.build(parsed, { table })

    expect(ops.eq).toHaveBeenCalledWith(table.count, 42)
  })

  it('should ignore filters for columns not in the table', () => {
    const table = mockTable('status')
    const parsed = makeParsed({
      filters: [{ field: 'nonexistent', operator: 'eq', value: 'x' }],
    })

    const result = adapter.build(parsed, { table })

    expect(result.where).toBeUndefined()
  })

  // ── Multiple filters → and() ──────────────────────────────────────────

  it('should combine multiple filters with and()', () => {
    const table = mockTable('status', 'priority')
    const parsed = makeParsed({
      filters: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'priority', operator: 'gt', value: '3' },
      ],
    })

    const result = adapter.build(parsed, { table })

    expect(ops.and).toHaveBeenCalled()
    expect(result.where).toBeDefined()
  })

  it('should not wrap a single filter in and()', () => {
    const table = mockTable('status')
    const parsed = makeParsed({
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    })

    const result = adapter.build(parsed, { table })

    expect(ops.and).not.toHaveBeenCalled()
    expect(result.where).toEqual({ op: 'eq', col: table.status, val: 'active' })
  })

  // ── Search ─────────────────────────────────────────────────────────────

  it('should build a search condition with or() + ilike()', () => {
    const table = mockTable('name', 'email')
    const parsed = makeParsed({ search: 'test' })

    adapter.build(parsed, { table, searchColumns: ['name', 'email'] })

    expect(ops.ilike).toHaveBeenCalledWith(table.name, '%test%')
    expect(ops.ilike).toHaveBeenCalledWith(table.email, '%test%')
    expect(ops.or).toHaveBeenCalled()
  })

  it('should ignore search columns that do not exist on the table', () => {
    const table = mockTable('name')
    const parsed = makeParsed({ search: 'test' })

    adapter.build(parsed, { table, searchColumns: ['name', 'missing'] })

    expect(ops.ilike).toHaveBeenCalledTimes(1)
    expect(ops.ilike).toHaveBeenCalledWith(table.name, '%test%')
  })

  it('should not add search condition when search string is empty', () => {
    const table = mockTable('name')
    const parsed = makeParsed({ search: '' })

    const result = adapter.build(parsed, { table, searchColumns: ['name'] })

    expect(ops.or).not.toHaveBeenCalled()
    expect(result.where).toBeUndefined()
  })

  // ── Sort ───────────────────────────────────────────────────────────────

  it('should build asc sort', () => {
    const table = mockTable('createdAt')
    const parsed = makeParsed({
      sort: [{ field: 'createdAt', direction: 'asc' }],
    })

    const result = adapter.build(parsed, { table })

    expect(ops.asc).toHaveBeenCalledWith(table.createdAt)
    expect(result.orderBy).toHaveLength(1)
  })

  it('should build desc sort', () => {
    const table = mockTable('createdAt')
    const parsed = makeParsed({
      sort: [{ field: 'createdAt', direction: 'desc' }],
    })

    const result = adapter.build(parsed, { table })

    expect(ops.desc).toHaveBeenCalledWith(table.createdAt)
    expect(result.orderBy).toHaveLength(1)
  })

  it('should handle multiple sort items', () => {
    const table = mockTable('name', 'createdAt')
    const parsed = makeParsed({
      sort: [
        { field: 'name', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ],
    })

    const result = adapter.build(parsed, { table })

    expect(result.orderBy).toHaveLength(2)
    expect(ops.asc).toHaveBeenCalledWith(table.name)
    expect(ops.desc).toHaveBeenCalledWith(table.createdAt)
  })

  it('should ignore sort fields not in the table', () => {
    const table = mockTable('name')
    const parsed = makeParsed({
      sort: [{ field: 'nonexistent', direction: 'asc' }],
    })

    const result = adapter.build(parsed, { table })

    expect(result.orderBy).toEqual([])
  })
})

// ── DrizzleQueryAdapter.buildFromColumns() (column-based) ────────────────

describe('DrizzleQueryAdapter.buildFromColumns()', () => {
  let ops: DrizzleOps
  let adapter: DrizzleQueryAdapter

  beforeEach(() => {
    ops = createMockOps()
    adapter = new DrizzleQueryAdapter(ops)
  })

  it('should return pagination from parsed query', () => {
    const result = adapter.buildFromColumns(
      makeParsed({ pagination: { page: 3, limit: 25, offset: 50 } }),
      { columns: {} },
    )

    expect(result.limit).toBe(25)
    expect(result.offset).toBe(50)
  })

  // ── Base condition ────────────────────────────────────────────────────

  it('should prepend baseCondition to where clause', () => {
    const baseCondition = { op: 'eq', col: 'tenantId', val: 't1' }
    const result = adapter.buildFromColumns(makeParsed(), {
      columns: {},
      baseCondition,
    })

    expect(result.where).toBe(baseCondition)
  })

  it('should combine baseCondition with filters using and()', () => {
    const baseCondition = { op: 'eq', col: 'tenantId', val: 't1' }
    const statusCol = mockColumn('status', 'string')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      }),
      { columns: { status: statusCol }, baseCondition },
    )

    expect(ops.and).toHaveBeenCalled()
    expect(ops.eq).toHaveBeenCalledWith(statusCol, 'active')
  })

  // ── Type coercion by dataType ─────────────────────────────────────────

  it('should coerce boolean dataType: "true" -> true, "1" -> true, "false" -> false', () => {
    const col = mockColumn('isActive', 'boolean')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'isActive', operator: 'eq', value: 'true' }],
      }),
      { columns: { isActive: col } },
    )
    expect(ops.eq).toHaveBeenCalledWith(col, true)

    vi.clearAllMocks()

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'isActive', operator: 'eq', value: '1' }],
      }),
      { columns: { isActive: col } },
    )
    expect(ops.eq).toHaveBeenCalledWith(col, true)

    vi.clearAllMocks()

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'isActive', operator: 'eq', value: 'false' }],
      }),
      { columns: { isActive: col } },
    )
    expect(ops.eq).toHaveBeenCalledWith(col, false)
  })

  it('should coerce number dataType to Number', () => {
    const col = mockColumn('age', 'number')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'age', operator: 'gt', value: '25' }],
      }),
      { columns: { age: col } },
    )

    expect(ops.gt).toHaveBeenCalledWith(col, 25)
  })

  it('should coerce bigint dataType to Number', () => {
    const col = mockColumn('total', 'bigint')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'total', operator: 'eq', value: '999' }],
      }),
      { columns: { total: col } },
    )

    expect(ops.eq).toHaveBeenCalledWith(col, 999)
  })

  it('should coerce date dataType to Date object', () => {
    const col = mockColumn('createdAt', 'date')
    const dateStr = '2024-06-15T10:30:00.000Z'

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'createdAt', operator: 'gte', value: dateStr }],
      }),
      { columns: { createdAt: col } },
    )

    expect(ops.gte).toHaveBeenCalledWith(col, new Date(dateStr))
  })

  it('should keep string value when dataType is string or unknown', () => {
    const col = mockColumn('label', 'string')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'label', operator: 'eq', value: 'hello' }],
      }),
      { columns: { label: col } },
    )

    expect(ops.eq).toHaveBeenCalledWith(col, 'hello')
  })

  it('should fall back to generic coercion when column has no dataType', () => {
    const col = mockColumn('count', undefined)

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'count', operator: 'eq', value: '42' }],
      }),
      { columns: { count: col } },
    )

    // Generic coercion converts numeric strings to numbers
    expect(ops.eq).toHaveBeenCalledWith(col, 42)
  })

  // ── Filter operators (column-based) ───────────────────────────────────

  it('should build contains / starts / ends using ilike', () => {
    const col = mockColumn('title', 'string')
    const config: DrizzleColumnQueryConfig = { columns: { title: col } }

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'title', operator: 'contains', value: 'bug' }],
      }),
      config,
    )
    expect(ops.ilike).toHaveBeenCalledWith(col, '%bug%')

    vi.clearAllMocks()

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'title', operator: 'starts', value: 'FIX' }],
      }),
      config,
    )
    expect(ops.ilike).toHaveBeenCalledWith(col, 'FIX%')

    vi.clearAllMocks()

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'title', operator: 'ends', value: 'done' }],
      }),
      config,
    )
    expect(ops.ilike).toHaveBeenCalledWith(col, '%done')
  })

  it('should build in filter with type coercion per item', () => {
    const col = mockColumn('priority', 'number')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'priority', operator: 'in', value: '1,2,3' }],
      }),
      { columns: { priority: col } },
    )

    expect(ops.inArray).toHaveBeenCalledWith(col, [1, 2, 3])
  })

  it('should build between filter using ops.between when available', () => {
    const col = mockColumn('price', 'number')

    adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'price', operator: 'between', value: '10,50' }],
      }),
      { columns: { price: col } },
    )

    expect(ops.between).toHaveBeenCalledWith(col, 10, 50)
  })

  it('should fall back to gte+lte for between when ops.between is undefined', () => {
    const opsNoBetween = createMockOps()
    opsNoBetween.between = undefined
    const adapterNoBetween = new DrizzleQueryAdapter(opsNoBetween)

    const col = mockColumn('price', 'number')

    adapterNoBetween.buildFromColumns(
      makeParsed({
        filters: [{ field: 'price', operator: 'between', value: '10,50' }],
      }),
      { columns: { price: col } },
    )

    expect(opsNoBetween.gte).toHaveBeenCalledWith(col, 10)
    expect(opsNoBetween.lte).toHaveBeenCalledWith(col, 50)
    expect(opsNoBetween.and).toHaveBeenCalled()
  })

  it('should ignore filters for columns not in config.columns', () => {
    const result = adapter.buildFromColumns(
      makeParsed({
        filters: [{ field: 'missing', operator: 'eq', value: 'x' }],
      }),
      { columns: {} },
    )

    expect(result.where).toBeUndefined()
  })

  // ── Search (column-based) ─────────────────────────────────────────────

  it('should build search with or() across searchColumns', () => {
    const nameCol = mockColumn('name', 'string')
    const emailCol = mockColumn('email', 'string')

    adapter.buildFromColumns(makeParsed({ search: 'hello' }), {
      columns: {},
      searchColumns: [nameCol, emailCol],
    })

    expect(ops.ilike).toHaveBeenCalledWith(nameCol, '%hello%')
    expect(ops.ilike).toHaveBeenCalledWith(emailCol, '%hello%')
    expect(ops.or).toHaveBeenCalled()
  })

  // ── Sort (column-based) ───────────────────────────────────────────────

  it('should use sortable map for ordering', () => {
    const titleCol = mockColumn('title', 'string')
    const dateCol = mockColumn('createdAt', 'date')

    const result = adapter.buildFromColumns(
      makeParsed({
        sort: [
          { field: 'title', direction: 'asc' },
          { field: 'createdAt', direction: 'desc' },
        ],
      }),
      {
        columns: {},
        sortable: { title: titleCol, createdAt: dateCol },
      },
    )

    expect(ops.asc).toHaveBeenCalledWith(titleCol)
    expect(ops.desc).toHaveBeenCalledWith(dateCol)
    expect(result.orderBy).toHaveLength(2)
  })

  it('should fall back to columns map when sortable is not provided', () => {
    const statusCol = mockColumn('status', 'string')

    const result = adapter.buildFromColumns(
      makeParsed({ sort: [{ field: 'status', direction: 'asc' }] }),
      { columns: { status: statusCol } },
    )

    expect(ops.asc).toHaveBeenCalledWith(statusCol)
    expect(result.orderBy).toHaveLength(1)
  })

  it('should ignore sort fields not in the sortable map', () => {
    const result = adapter.buildFromColumns(
      makeParsed({ sort: [{ field: 'missing', direction: 'asc' }] }),
      { columns: {}, sortable: {} },
    )

    expect(result.orderBy).toEqual([])
  })
})

// ── toQueryFieldConfig() ─────────────────────────────────────────────────

describe('toQueryFieldConfig()', () => {
  it('should extract filterable keys from columns', () => {
    const result = toQueryFieldConfig({
      columns: {
        status: mockColumn('status'),
        priority: mockColumn('priority'),
      },
    })

    expect(result.filterable).toEqual(['status', 'priority'])
  })

  it('should extract sortable keys from sortable map', () => {
    const result = toQueryFieldConfig({
      columns: { status: mockColumn('status') },
      sortable: {
        name: mockColumn('name'),
        createdAt: mockColumn('createdAt'),
      },
    })

    expect(result.sortable).toEqual(['name', 'createdAt'])
  })

  it('should return empty sortable when sortable is not provided', () => {
    const result = toQueryFieldConfig({
      columns: { status: mockColumn('status') },
    })

    expect(result.sortable).toEqual([])
  })

  it('should extract searchable column names from searchColumns', () => {
    const result = toQueryFieldConfig({
      columns: {},
      searchColumns: [mockColumn('firstName'), mockColumn('lastName'), mockColumn('email')],
    })

    expect(result.searchable).toEqual(['firstName', 'lastName', 'email'])
  })

  it('should return empty searchable when searchColumns is not provided', () => {
    const result = toQueryFieldConfig({ columns: {} })

    expect(result.searchable).toEqual([])
  })

  it('should filter out columns without a name', () => {
    const result = toQueryFieldConfig({
      columns: {},
      searchColumns: [mockColumn('name'), { noNameProperty: true }],
    })

    expect(result.searchable).toEqual(['name'])
  })
})
