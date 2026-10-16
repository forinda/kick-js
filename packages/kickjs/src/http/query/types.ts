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

export const FILTER_OPERATORS = new Set<string>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'contains',
  'starts',
  'ends',
])

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
 * Helper that extracts the literal field union from a `QueryFieldConfig`
 * key. When the user passes `{ filterable: ['status', 'category'] } as const`,
 * `FieldsOf<typeof config, 'filterable'>` resolves to `'status' | 'category'`.
 *
 * Without `as const`, the arrays widen to `string[]` and the union falls
 * back to `string`. This is the documented escape hatch.
 */
export type FieldsOf<
  TConfig extends QueryFieldConfig | undefined,
  K extends 'filterable' | 'sortable' | 'searchable',
> = TConfig extends { readonly [P in K]: readonly (infer F)[] }
  ? F extends string
    ? F
    : string
  : TConfig extends { columns: infer C }
    ? K extends 'filterable'
      ? keyof C & string
      : string
    : string

/**
 * Narrowed `ParsedQuery` whose `filters[].field` and `sort[].field`
 * unions are constrained to the literal whitelist passed to
 * `ctx.qs()` / `parseQuery()`. Extends `ParsedQuery`, so any function
 * accepting `ParsedQuery` accepts a `TypedParsedQuery<X>` automatically
 * (subtype assignment, no codegen, backward compatible).
 *
 * @example
 * ```ts
 * const parsed = ctx.qs({
 *   filterable: ['status', 'priority'],
 *   sortable: ['createdAt'],
 * } as const)
 * parsed.filters[0]?.field // 'status' | 'priority'
 * parsed.sort[0]?.field    // 'createdAt'
 * ```
 */
export interface TypedParsedQuery<
  TConfig extends QueryFieldConfig | undefined,
> extends ParsedQuery {
  filters: Array<FilterItem & { field: FieldsOf<TConfig, 'filterable'> }>
  sort: Array<SortItem & { field: FieldsOf<TConfig, 'sortable'> }>
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
  /**
   * Relative links (path + query, never a host) to this page and its
   * neighbours. `next` / `prev` are `null` at the ends.
   */
  links: { self: string; next: string | null; prev: string | null }
}

/** A JSON primitive stored in a cursor. Dates arrive as ISO strings. */
export type CursorValue = string | number | boolean | null

/**
 * Where the previous page ended: the last row's values for the active sort
 * fields plus the id tie-breaker, keyed by field name — e.g.
 * `{ createdAt: '2026-01-01T00:00:00.000Z', id: 'u7' }`.
 *
 * Decoded from a client-supplied cursor and NOT signed: treat it as untrusted
 * input. Bind the values as query parameters and keep filters / authorization
 * scoping in the fetcher, so a forged cursor can only move the position,
 * never widen what the caller may see.
 */
export type CursorPosition = Readonly<Record<string, CursorValue>>

/** What `ctx.paginateCursor()` hands its fetcher. */
export interface CursorQuery<TConfig extends QueryFieldConfig | undefined = undefined> extends Omit<
  TypedParsedQuery<TConfig>,
  'pagination'
> {
  /** `null` on the first page. */
  cursor: CursorPosition | null
  /** Page size. Fetch `limit + 1` rows — the extra one tells whether a next page exists. */
  limit: number
}

/** Options for `ctx.paginateCursor()`. */
export interface CursorPaginateOptions<T = any> {
  /** Unique, stable tie-breaker field read off each row. Default `'id'`. */
  idField?: string
  /**
   * Build the cursor values from a row yourself, instead of reading the sort
   * fields + `idField` off it (e.g. when the row shape differs from the
   * sortable field names). Values must be JSON primitives.
   */
  cursorKey?: (row: T) => Record<string, CursorValue>
}

/** Standardized cursor (keyset) paginated response shape */
export interface CursorPaginatedResponse<T = any> {
  data: T[]
  meta: {
    limit: number
    hasNext: boolean
    /** Opaque; pass back as `?cursor=` for the next page. `null` on the last page. */
    nextCursor: string | null
  }
  /** Relative links (path + query, never a host); `next` is `null` on the last page. */
  links: { self: string; next: string | null }
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
