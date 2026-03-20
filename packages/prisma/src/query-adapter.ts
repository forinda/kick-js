import type { QueryBuilderAdapter, ParsedQuery, FilterItem, SortItem } from '@forinda/kickjs-http'

/** Configuration for the Prisma query builder adapter */
export interface PrismaQueryConfig {
  /** Columns to search across when a search string is provided */
  searchColumns?: string[]
}

/** Result shape matching Prisma's findMany arguments */
export interface PrismaQueryResult {
  where?: Record<string, any>
  orderBy?: Record<string, 'asc' | 'desc'>[]
  skip?: number
  take?: number
}

/**
 * Translates a ParsedQuery into Prisma-compatible `findMany` arguments.
 *
 * @example
 * ```ts
 * const adapter = new PrismaQueryAdapter()
 * const parsed = parseQuery(req.query)
 * const args = adapter.build(parsed, { searchColumns: ['name', 'email'] })
 * const users = await prisma.user.findMany(args)
 * ```
 */
export class PrismaQueryAdapter implements QueryBuilderAdapter<
  PrismaQueryResult,
  PrismaQueryConfig
> {
  readonly name = 'PrismaQueryAdapter'

  build(parsed: ParsedQuery, config: PrismaQueryConfig = {}): PrismaQueryResult {
    const result: PrismaQueryResult = {}

    // Build where clause from filters and search
    const whereConditions = this.buildFilters(parsed.filters)
    const searchCondition = this.buildSearch(parsed.search, config.searchColumns)

    if (whereConditions.length > 0 || searchCondition) {
      const andClauses: any[] = []

      if (whereConditions.length > 0) {
        andClauses.push(...whereConditions)
      }
      if (searchCondition) {
        andClauses.push(searchCondition)
      }

      result.where = andClauses.length === 1 ? andClauses[0] : { AND: andClauses }
    }

    // Build orderBy
    const orderBy = this.buildSort(parsed.sort)
    if (orderBy.length > 0) {
      result.orderBy = orderBy
    }

    // Build pagination
    result.skip = parsed.pagination.offset
    result.take = parsed.pagination.limit

    return result
  }

  /** Map FilterItem[] to Prisma where conditions */
  private buildFilters(filters: FilterItem[]): Record<string, any>[] {
    return filters.map((filter) => {
      const { field, operator, value } = filter

      switch (operator) {
        case 'eq':
          return { [field]: { equals: this.coerce(value) } }
        case 'neq':
          return { [field]: { not: this.coerce(value) } }
        case 'gt':
          return { [field]: { gt: this.coerce(value) } }
        case 'gte':
          return { [field]: { gte: this.coerce(value) } }
        case 'lt':
          return { [field]: { lt: this.coerce(value) } }
        case 'lte':
          return { [field]: { lte: this.coerce(value) } }
        case 'contains':
          return { [field]: { contains: value, mode: 'insensitive' } }
        case 'starts':
          return { [field]: { startsWith: value, mode: 'insensitive' } }
        case 'ends':
          return { [field]: { endsWith: value, mode: 'insensitive' } }
        case 'in': {
          const values = value.split(',').map((v) => this.coerce(v.trim()))
          return { [field]: { in: values } }
        }
        case 'between': {
          const [min, max] = value.split(',').map((v) => this.coerce(v.trim()))
          return { [field]: { gte: min, lte: max } }
        }
        default:
          return { [field]: { equals: this.coerce(value) } }
      }
    })
  }

  /** Build Prisma orderBy from SortItem[] */
  private buildSort(sort: SortItem[]): Record<string, 'asc' | 'desc'>[] {
    return sort.map((item) => ({ [item.field]: item.direction }))
  }

  /** Build a search condition using OR + contains across multiple columns */
  private buildSearch(search: string, searchColumns?: string[]): Record<string, any> | null {
    if (!search || !searchColumns || searchColumns.length === 0) {
      return null
    }

    return {
      OR: searchColumns.map((column) => ({
        [column]: { contains: search, mode: 'insensitive' },
      })),
    }
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
