import type { QueryBuilderAdapter, ParsedQuery, FilterItem, SortItem } from '@forinda/kickjs-http'

/**
 * Configuration for the Drizzle query builder adapter.
 *
 * Unlike Prisma which uses its own query builder API, Drizzle uses SQL-like
 * operators (`eq`, `gt`, `like`, etc.) from `drizzle-orm`. This adapter
 * produces a config object that can be spread into Drizzle's `select().from().where()`.
 */
export interface DrizzleQueryConfig {
  /** The Drizzle table schema object (e.g., `users` from your schema) */
  table: Record<string, any>
  /** Columns to search across when a search string is provided */
  searchColumns?: string[]
}

/**
 * Type-safe Drizzle query configuration using Column objects.
 *
 * Use this instead of `DrizzleQueryConfig` for type-safe column references
 * that are validated at compile time. Column objects carry `dataType` metadata
 * enabling automatic type coercion of filter values.
 *
 * @example
 * ```ts
 * import { users } from './schema'
 * import type { DrizzleColumnQueryConfig } from '@forinda/kickjs-drizzle'
 *
 * const config: DrizzleColumnQueryConfig = {
 *   columns: {
 *     status: users.status,
 *     isActive: users.isActive,
 *     createdAt: users.createdAt,
 *   },
 *   sortable: {
 *     name: users.name,
 *     createdAt: users.createdAt,
 *   },
 *   searchColumns: [users.firstName, users.lastName, users.email],
 *   baseCondition: eq(users.tenantId, tenantId),
 * }
 * ```
 */
export interface DrizzleColumnQueryConfig {
  /**
   * Map of filterable field names to Drizzle Column objects.
   * Keys are the query parameter names, values are the actual schema columns.
   * The column's `dataType` is used for automatic type coercion.
   */
  columns: Record<string, any>

  /**
   * Map of sortable field names to Drizzle Column objects.
   * If not provided, falls back to `columns` for sort lookups.
   */
  sortable?: Record<string, any>

  /**
   * Column objects to search across when a search string is provided.
   * Each entry should be a Drizzle Column (not a string).
   */
  searchColumns?: any[]

  /**
   * A pre-built SQL condition that is always prepended to the WHERE clause.
   * Use for scoping queries by tenant, workspace, or other invariants.
   *
   * @example
   * ```ts
   * baseCondition: and(eq(tasks.tenantId, tid), eq(tasks.workspaceId, wid))
   * ```
   */
  baseCondition?: any
}

/**
 * Configuration type for defining query param schemas with Drizzle Column objects.
 *
 * Used in constants files to define which columns are filterable, sortable, and searchable.
 * This type is consumed by both `DrizzleQueryAdapter.buildFromColumns()` and `@ApiQueryParams()`.
 *
 * @example
 * ```ts
 * import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
 * import { tasks } from '@/db/schema'
 *
 * export const TASK_QUERY_CONFIG: DrizzleQueryParamsConfig = {
 *   columns: {
 *     status: tasks.status,
 *     priority: tasks.priority,
 *   },
 *   sortable: {
 *     title: tasks.title,
 *     createdAt: tasks.createdAt,
 *   },
 *   searchColumns: [tasks.title, tasks.key],
 * }
 * ```
 */
export interface DrizzleQueryParamsConfig {
  /** Filterable columns: keys are query param names, values are Drizzle Column objects */
  columns: Record<string, any>
  /** Sortable columns: keys are query param names, values are Drizzle Column objects */
  sortable?: Record<string, any>
  /** Columns for text search */
  searchColumns?: any[]
  /** Optional base condition for scoping (tenant, workspace, etc.) */
  baseCondition?: any
}

/**
 * Convert a DrizzleQueryParamsConfig into a string-based QueryFieldConfig.
 * Useful for passing to `@ApiQueryParams()` or other APIs that expect string arrays.
 *
 * @example
 * ```ts
 * import { toQueryFieldConfig } from '@forinda/kickjs-drizzle'
 *
 * const fieldConfig = toQueryFieldConfig(TASK_QUERY_CONFIG)
 * // → { filterable: ['status', 'priority'], sortable: ['title', 'createdAt'], searchable: [] }
 * ```
 */
export function toQueryFieldConfig(config: DrizzleQueryParamsConfig): {
  filterable: string[]
  sortable: string[]
  searchable: string[]
} {
  return {
    filterable: Object.keys(config.columns),
    sortable: config.sortable ? Object.keys(config.sortable) : [],
    searchable: config.searchColumns
      ? config.searchColumns.map((col) => col.name ?? '').filter(Boolean)
      : [],
  }
}

/**
 * Result shape compatible with Drizzle's query builder.
 * Use with `db.select().from(table).where(result.where).orderBy(...result.orderBy).limit(result.limit).offset(result.offset)`
 */
export interface DrizzleQueryResult {
  /** SQL condition — pass to `.where()` */
  where?: any
  /** Array of order expressions — spread into `.orderBy()` */
  orderBy: any[]
  /** Row limit — pass to `.limit()` */
  limit: number
  /** Row offset — pass to `.offset()` */
  offset: number
}

/**
 * Drizzle operator functions required by the query adapter.
 * Pass these from your `drizzle-orm` import to avoid version coupling.
 *
 * @example
 * ```ts
 * import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc } from 'drizzle-orm'
 *
 * const adapter = new DrizzleQueryAdapter({
 *   eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc,
 * })
 * ```
 */
export interface DrizzleOps {
  eq: (column: any, value: any) => any
  ne: (column: any, value: any) => any
  gt: (column: any, value: any) => any
  gte: (column: any, value: any) => any
  lt: (column: any, value: any) => any
  lte: (column: any, value: any) => any
  ilike: (column: any, value: string) => any
  inArray: (column: any, values: any[]) => any
  between?: (column: any, min: any, max: any) => any
  and: (...conditions: any[]) => any
  or: (...conditions: any[]) => any
  asc: (column: any) => any
  desc: (column: any) => any
}

/**
 * Translates a ParsedQuery into Drizzle-compatible query parts.
 *
 * Supports two modes:
 * 1. **String-based** (legacy): `build(parsed, { table, searchColumns })` — looks up columns by string name
 * 2. **Column-based** (recommended): `buildFromColumns(parsed, config)` — uses actual Column objects for type safety
 *
 * @example
 * ```ts
 * // String-based (legacy)
 * const query = adapter.build(parsed, { table: users, searchColumns: ['name', 'email'] })
 *
 * // Column-based (recommended)
 * const query = adapter.buildFromColumns(parsed, {
 *   columns: { status: users.status, isActive: users.isActive },
 *   searchColumns: [users.name, users.email],
 *   baseCondition: eq(users.tenantId, tid),
 * })
 *
 * const results = await db
 *   .select().from(users)
 *   .where(query.where)
 *   .orderBy(...query.orderBy)
 *   .limit(query.limit)
 *   .offset(query.offset)
 * ```
 */
export class DrizzleQueryAdapter implements QueryBuilderAdapter<
  DrizzleQueryResult,
  DrizzleQueryConfig
> {
  readonly name = 'DrizzleQueryAdapter'

  constructor(private ops: DrizzleOps) {}

  /**
   * Build query from string-based config (legacy API).
   * Prefer `buildFromColumns()` for type safety.
   */
  build(
    parsed: ParsedQuery,
    config: DrizzleQueryConfig = {} as DrizzleQueryConfig,
  ): DrizzleQueryResult {
    const result: DrizzleQueryResult = {
      orderBy: [],
      limit: parsed.pagination.limit,
      offset: parsed.pagination.offset,
    }

    // Build where conditions
    const conditions: any[] = []

    // Filters
    for (const filter of parsed.filters) {
      const condition = this.buildFilter(config.table, filter)
      if (condition) conditions.push(condition)
    }

    // Search
    if (parsed.search && config.searchColumns && config.searchColumns.length > 0) {
      const searchConditions = config.searchColumns
        .filter((col) => config.table[col])
        .map((col) => this.ops.ilike(config.table[col], `%${parsed.search}%`))

      if (searchConditions.length > 0) {
        conditions.push(this.ops.or(...searchConditions))
      }
    }

    // Combine conditions
    if (conditions.length === 1) {
      result.where = conditions[0]
    } else if (conditions.length > 1) {
      result.where = this.ops.and(...conditions)
    }

    // Sort
    result.orderBy = this.buildSort(config.table, parsed.sort)

    return result
  }

  /**
   * Build query using Column objects for type-safe filtering, sorting, and search.
   *
   * Features over `build()`:
   * - Column references validated at compile time
   * - Automatic type coercion based on `column.dataType` (boolean, number, date)
   * - `baseCondition` support for tenant/workspace scoping
   * - Native `between` operator support
   * - Separate `sortable` map so filterable and sortable columns can differ
   *
   * @example
   * ```ts
   * const query = adapter.buildFromColumns(parsed, {
   *   columns: { status: tasks.status, priority: tasks.priority },
   *   sortable: { title: tasks.title, createdAt: tasks.createdAt },
   *   searchColumns: [tasks.title, tasks.key],
   *   baseCondition: eq(tasks.workspaceId, wid),
   * })
   * ```
   */
  buildFromColumns(parsed: ParsedQuery, config: DrizzleColumnQueryConfig): DrizzleQueryResult {
    const result: DrizzleQueryResult = {
      orderBy: [],
      limit: parsed.pagination.limit,
      offset: parsed.pagination.offset,
    }

    const conditions: any[] = []

    // Prepend base condition (tenant/workspace scoping)
    if (config.baseCondition) {
      conditions.push(config.baseCondition)
    }

    // Filters — resolve column from the columns map
    for (const filter of parsed.filters) {
      const column = config.columns[filter.field]
      if (!column) continue
      const condition = this.buildColumnFilter(column, filter)
      if (condition) conditions.push(condition)
    }

    // Search — use Column objects directly
    if (parsed.search && config.searchColumns && config.searchColumns.length > 0) {
      const searchConditions = config.searchColumns.map((col) =>
        this.ops.ilike(col, `%${parsed.search}%`),
      )
      if (searchConditions.length > 0) {
        conditions.push(this.ops.or(...searchConditions))
      }
    }

    // Combine conditions
    if (conditions.length === 1) {
      result.where = conditions[0]
    } else if (conditions.length > 1) {
      result.where = this.ops.and(...conditions)
    }

    // Sort — use sortable map, falling back to columns
    const sortMap = config.sortable ?? config.columns
    result.orderBy = parsed.sort
      .filter((item) => sortMap[item.field])
      .map((item) =>
        item.direction === 'desc'
          ? this.ops.desc(sortMap[item.field])
          : this.ops.asc(sortMap[item.field]),
      )

    return result
  }

  /** Map a single FilterItem to a Drizzle condition using string-based table lookup */
  private buildFilter(table: Record<string, any>, filter: FilterItem): any {
    const column = table[filter.field]
    if (!column) return null

    const value = this.coerce(filter.value)

    switch (filter.operator) {
      case 'eq':
        return this.ops.eq(column, value)
      case 'neq':
        return this.ops.ne(column, value)
      case 'gt':
        return this.ops.gt(column, value)
      case 'gte':
        return this.ops.gte(column, value)
      case 'lt':
        return this.ops.lt(column, value)
      case 'lte':
        return this.ops.lte(column, value)
      case 'contains':
        return this.ops.ilike(column, `%${filter.value}%`)
      case 'starts':
        return this.ops.ilike(column, `${filter.value}%`)
      case 'ends':
        return this.ops.ilike(column, `%${filter.value}`)
      case 'in': {
        const values = filter.value.split(',').map((v) => this.coerce(v.trim()))
        return this.ops.inArray(column, values)
      }
      case 'between': {
        const [min, max] = filter.value.split(',').map((v) => this.coerce(v.trim()))
        return this.ops.and(this.ops.gte(column, min), this.ops.lte(column, max))
      }
      default:
        return this.ops.eq(column, value)
    }
  }

  /**
   * Map a FilterItem to a Drizzle condition using a Column object.
   * Coerces values based on `column.dataType` for type-safe filtering.
   */
  private buildColumnFilter(column: any, filter: FilterItem): any {
    const value = this.coerceByDataType(filter.value, column.dataType)

    switch (filter.operator) {
      case 'eq':
        return this.ops.eq(column, value)
      case 'neq':
        return this.ops.ne(column, value)
      case 'gt':
        return this.ops.gt(column, value)
      case 'gte':
        return this.ops.gte(column, value)
      case 'lt':
        return this.ops.lt(column, value)
      case 'lte':
        return this.ops.lte(column, value)
      case 'contains':
        return this.ops.ilike(column, `%${filter.value}%`)
      case 'starts':
        return this.ops.ilike(column, `${filter.value}%`)
      case 'ends':
        return this.ops.ilike(column, `%${filter.value}`)
      case 'in': {
        const values = filter.value
          .split(',')
          .map((v) => this.coerceByDataType(v.trim(), column.dataType))
        return this.ops.inArray(column, values)
      }
      case 'between': {
        const [minStr, maxStr] = filter.value.split(',').map((v) => v.trim())
        const min = this.coerceByDataType(minStr, column.dataType)
        const max = this.coerceByDataType(maxStr, column.dataType)
        if (this.ops.between) {
          return this.ops.between(column, min, max)
        }
        return this.ops.and(this.ops.gte(column, min), this.ops.lte(column, max))
      }
      default:
        return this.ops.eq(column, value)
    }
  }

  /** Build Drizzle orderBy from SortItem[] */
  private buildSort(table: Record<string, any>, sort: SortItem[]): any[] {
    return sort
      .filter((item) => table[item.field])
      .map((item) =>
        item.direction === 'desc'
          ? this.ops.desc(table[item.field])
          : this.ops.asc(table[item.field]),
      )
  }

  /** Attempt to coerce a string value to a number or boolean if appropriate */
  private coerce(value: string): string | number | boolean {
    if (value === 'true') return true
    if (value === 'false') return false
    const num = Number(value)
    if (!Number.isNaN(num) && value.trim() !== '') return num
    return value
  }

  /**
   * Coerce a string value based on the column's dataType.
   *
   * - `'boolean'` → `true`/`false`
   * - `'number'` / `'bigint'` → `Number(value)`
   * - `'date'` → `new Date(value)` (ISO 8601 strings)
   * - Everything else → original string
   */
  private coerceByDataType(value: string, dataType?: string): string | number | boolean | Date {
    if (!dataType) return this.coerce(value)

    switch (dataType) {
      case 'boolean':
        return value === 'true' || value === '1'
      case 'number':
      case 'bigint': {
        const num = Number(value)
        return Number.isNaN(num) ? value : num
      }
      case 'date':
      case 'localDate':
      case 'localDateTime': {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date
      }
      default:
        return value
    }
  }
}
