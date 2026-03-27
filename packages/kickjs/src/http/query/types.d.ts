/** Supported filter operators for query string parsing */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'contains'
  | 'starts'
  | 'ends'
export declare const FILTER_OPERATORS: Set<string>
export interface FilterItem {
  field: string
  operator: FilterOperator
  value: string
}
export interface SortItem {
  field: string
  direction: 'asc' | 'desc'
}
export interface PaginationParams {
  page: number
  limit: number
  offset: number
}
/**
 * The result of parsing a query string. ORM-agnostic — pass this to
 * a query builder adapter (Drizzle, Prisma, Sequelize, etc.) to produce
 * database-specific query objects.
 */
export interface ParsedQuery {
  filters: FilterItem[]
  sort: SortItem[]
  pagination: PaginationParams
  search: string
}
/**
 * Restrict which fields can be filtered, sorted, or searched.
 * Fields not in the allow-list are silently ignored.
 *
 * Accepts two forms:
 * 1. **String arrays** (standard): `{ filterable: ['name', 'status'], sortable: ['createdAt'] }`
 * 2. **Column-object maps** (Drizzle-style): `{ columns: { name: col, status: col }, sortable: { createdAt: col } }`
 *
 * When column-object maps are provided, `Object.keys()` is used to derive the field names.
 */
export type QueryFieldConfig = StringQueryFieldConfig | ColumnQueryFieldConfig
export interface StringQueryFieldConfig {
  filterable?: string[]
  sortable?: string[]
  searchable?: string[]
}
/**
 * Column-object-based field config (e.g., from DrizzleQueryParamsConfig).
 * Keys are the field names used in query strings; values are ORM column references.
 */
export interface ColumnQueryFieldConfig {
  columns: Record<string, any>
  sortable?: Record<string, any>
  searchColumns?: any[]
  [key: string]: any
}
/** Standardized paginated response shape */
export interface PaginatedResponse<T = any> {
  data: T[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}
/**
 * Interface for ORM-specific query builder adapters.
 * Implement this to translate a `ParsedQuery` into your ORM's query format.
 *
 * @example
 * ```ts
 * // Drizzle adapter
 * class DrizzleQueryAdapter implements QueryBuilderAdapter<DrizzleQueryResult> {
 *   build(parsed: ParsedQuery, config: DrizzleConfig): DrizzleQueryResult {
 *     // Convert filters → Drizzle SQL conditions
 *     // Convert sort → Drizzle orderBy
 *     return { where, orderBy, limit, offset }
 *   }
 * }
 *
 * // Prisma adapter
 * class PrismaQueryAdapter implements QueryBuilderAdapter<PrismaQueryResult> {
 *   build(parsed: ParsedQuery, config: PrismaConfig): PrismaQueryResult {
 *     return { where, orderBy, skip, take }
 *   }
 * }
 * ```
 */
export interface QueryBuilderAdapter<TResult = any, TConfig = any> {
  /** Human-readable name for debugging */
  readonly name: string
  /**
   * Convert a ParsedQuery into an ORM-specific query object.
   * @param parsed - The ORM-agnostic parsed query
   * @param config - ORM-specific configuration (column maps, search columns, etc.)
   */
  build(parsed: ParsedQuery, config: TConfig): TResult
}
//# sourceMappingURL=types.d.ts.map
