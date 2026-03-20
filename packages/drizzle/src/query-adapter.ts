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
 * import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc } from 'drizzle-orm'
 *
 * const adapter = new DrizzleQueryAdapter({
 *   eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc,
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
  and: (...conditions: any[]) => any
  or: (...conditions: any[]) => any
  asc: (column: any) => any
  desc: (column: any) => any
}

/**
 * Translates a ParsedQuery into Drizzle-compatible query parts.
 *
 * @example
 * ```ts
 * import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc } from 'drizzle-orm'
 * import { users } from './schema'
 *
 * const adapter = new DrizzleQueryAdapter({
 *   eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc,
 * })
 * const parsed = ctx.qs({ filters: ['name', 'email'], sort: ['name'] })
 * const query = adapter.build(parsed, { table: users, searchColumns: ['name', 'email'] })
 *
 * const results = await db
 *   .select()
 *   .from(users)
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

  /** Map a single FilterItem to a Drizzle condition */
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
}
