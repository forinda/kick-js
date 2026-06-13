import {
  FILTER_OPERATORS,
  type FilterItem,
  type FilterOperator,
  type SortItem,
  type PaginationParams,
  type ParsedQuery,
  type QueryFieldConfig,
  type StringQueryFieldConfig,
  type TypedParsedQuery,
} from './types'

// ── Configurable defaults ───────────────────────────────────────────────

/**
 * Why a rejected field/value was dropped. Surfaced through
 * {@link ParseQueryOptions.onReject} so a caller can warn, count, or
 * return a 400 instead of the historical silent drop.
 */
export type QueryRejectReason = 'field-not-allowed' | 'unknown-operator' | 'truncated'

export interface QueryRejection {
  kind: 'filter' | 'sort' | 'search'
  field: string
  reason: QueryRejectReason
}

export interface ParseQueryOptions {
  /** Hard cap on `limit`. Default: global (100, override via {@link setQueryParsingDefaults}). */
  maxLimit?: number
  /** `limit` when the query omits one. Default: global (20). */
  defaultLimit?: number
  /** Max `q` length before truncation. Default: global (200). */
  maxSearchLength?: number
  /**
   * Called once per dropped filter/sort field or truncated search.
   * The historical behaviour is a silent drop; wire this to a logger or
   * a 400 to make over-broad / typo'd queries visible.
   */
  onReject?: (rejection: QueryRejection) => void
}

interface QueryParsingDefaults {
  maxLimit: number
  defaultLimit: number
  maxSearchLength: number
  defaultPage: number
}

const BUILTIN_DEFAULTS: QueryParsingDefaults = {
  maxLimit: 100,
  defaultLimit: 20,
  maxSearchLength: 200,
  defaultPage: 1,
}

const defaults: QueryParsingDefaults = { ...BUILTIN_DEFAULTS }

/**
 * Globally override the query-parsing limits — call once at bootstrap.
 * Per-call {@link ParseQueryOptions} still take precedence over these.
 */
export function setQueryParsingDefaults(
  partial: Partial<Omit<QueryParsingDefaults, 'defaultPage'>>,
): void {
  if (partial.maxLimit !== undefined) defaults.maxLimit = partial.maxLimit
  if (partial.defaultLimit !== undefined) defaults.defaultLimit = partial.defaultLimit
  if (partial.maxSearchLength !== undefined) defaults.maxSearchLength = partial.maxSearchLength
}

/** Read the current global query-parsing defaults (a copy). */
export function getQueryParsingDefaults(): Readonly<QueryParsingDefaults> {
  return { ...defaults }
}

/**
 * Restore the built-in query-parsing defaults (maxLimit 100, defaultLimit
 * 20, maxSearchLength 200). Useful in test teardown after a
 * {@link setQueryParsingDefaults} override so global state can't leak
 * between tests.
 */
export function resetQueryParsingDefaults(): void {
  Object.assign(defaults, BUILTIN_DEFAULTS)
}

// ── Individual parsers ──────────────────────────────────────────────────

/** Parse filter strings like "status:eq:active" into structured objects */
export function parseFilters(
  filterParam: string | string[] | undefined,
  allowedFields?: string[],
  options?: Pick<ParseQueryOptions, 'onReject'>,
): FilterItem[] {
  if (!filterParam) return []

  const items = Array.isArray(filterParam) ? filterParam : [filterParam]
  const results: FilterItem[] = []
  const allowed = allowedFields ? new Set(allowedFields) : null
  const onReject = options?.onReject

  for (const item of items) {
    // Split on first two colons only — value may contain colons (e.g. timestamps)
    const firstColon = item.indexOf(':')
    if (firstColon === -1) continue

    const secondColon = item.indexOf(':', firstColon + 1)
    if (secondColon === -1) continue

    const field = item.slice(0, firstColon)
    const operator = item.slice(firstColon + 1, secondColon)
    const value = item.slice(secondColon + 1)

    if (!field || !value) continue
    if (!FILTER_OPERATORS.has(operator)) {
      onReject?.({ kind: 'filter', field, reason: 'unknown-operator' })
      continue
    }
    if (allowed && !allowed.has(field)) {
      onReject?.({ kind: 'filter', field, reason: 'field-not-allowed' })
      continue
    }

    results.push({ field, operator: operator as FilterOperator, value })
  }

  return results
}

/** Parse sort strings like "firstName:asc" into structured objects */
export function parseSort(
  sortParam: string | string[] | undefined,
  allowedFields?: string[],
  options?: Pick<ParseQueryOptions, 'onReject'>,
): SortItem[] {
  if (!sortParam) return []

  const items = Array.isArray(sortParam) ? sortParam : [sortParam]
  const results: SortItem[] = []
  const allowed = allowedFields ? new Set(allowedFields) : null
  const onReject = options?.onReject

  for (const item of items) {
    // Split on last colon so field names with colons work
    const lastColon = item.lastIndexOf(':')
    if (lastColon === -1) continue

    const field = item.slice(0, lastColon)
    const dir = item.slice(lastColon + 1).toLowerCase()

    if (!field) continue
    if (dir !== 'asc' && dir !== 'desc') continue
    if (allowed && !allowed.has(field)) {
      onReject?.({ kind: 'sort', field, reason: 'field-not-allowed' })
      continue
    }

    results.push({ field, direction: dir })
  }

  return results
}

/** Parse page/limit into pagination with computed offset */
export function parsePagination(
  params: {
    page?: string | number
    limit?: string | number
  },
  options?: Pick<ParseQueryOptions, 'maxLimit' | 'defaultLimit'>,
): PaginationParams {
  const defaultLimit = options?.defaultLimit ?? defaults.defaultLimit
  const maxLimit = options?.maxLimit ?? defaults.maxLimit

  let page =
    typeof params.page === 'string'
      ? Number.parseInt(params.page, 10)
      : (params.page ?? defaults.defaultPage)
  let limit =
    typeof params.limit === 'string'
      ? Number.parseInt(params.limit, 10)
      : (params.limit ?? defaultLimit)

  if (Number.isNaN(page) || page < 1) page = defaults.defaultPage
  if (Number.isNaN(limit) || limit < 1) limit = defaultLimit
  if (limit > maxLimit) limit = maxLimit

  return { page, limit, offset: (page - 1) * limit }
}

/** Sanitize and truncate search query */
export function parseSearchQuery(
  q: string | undefined,
  options?: Pick<ParseQueryOptions, 'maxSearchLength' | 'onReject'>,
): string {
  if (!q) return ''
  const maxLen = options?.maxSearchLength ?? defaults.maxSearchLength
  const trimmed = q.trim()
  if (trimmed.length > maxLen) {
    options?.onReject?.({ kind: 'search', field: 'q', reason: 'truncated' })
    return trimmed.slice(0, maxLen)
  }
  return trimmed
}

// ── Config normalizer ───────────────────────────────────────────────────

/**
 * Normalize a QueryFieldConfig into the string-based form.
 * Detects column-object-based configs (DrizzleQueryParamsConfig) by checking
 * for a `columns` property and extracts `Object.keys()`.
 */
function normalizeFieldConfig(config?: QueryFieldConfig): StringQueryFieldConfig | undefined {
  if (!config) return undefined

  // Column-object-based config (e.g., DrizzleQueryParamsConfig)
  if ('columns' in config && config.columns && typeof config.columns === 'object') {
    return {
      filterable: Object.keys(config.columns),
      sortable: config.sortable ? Object.keys(config.sortable) : undefined,
      searchable: undefined, // searchColumns are Column objects, not used for string filtering
    }
  }

  // Already string-based
  return config as StringQueryFieldConfig
}

// ── Combined parser ─────────────────────────────────────────────────────

/**
 * Parse a raw Express query object into a structured, ORM-agnostic ParsedQuery.
 *
 * @param query - Raw query string object from `req.query` or Zod-validated object
 * @param fieldConfig - Optional field restrictions (whitelist filterable/sortable/searchable).
 *   Accepts both string-based configs (`{ filterable, sortable, searchable }`) and
 *   column-object configs (`{ columns, sortable, searchColumns }`).
 * @param options - Limits + an `onReject` hook for dropped/truncated input.
 *
 * @example
 * ```ts
 * // String-based config
 * const parsed = parseQuery(ctx.query, {
 *   filterable: ['status', 'priority'],
 *   sortable: ['createdAt', 'title'],
 * })
 *
 * // Column-object config (DrizzleQueryParamsConfig)
 * const parsed = parseQuery(ctx.query, TASK_QUERY_CONFIG)
 * ```
 *
 * Query string format:
 * - Filters: `?filter=field:operator:value` (repeatable)
 * - Sort: `?sort=field:asc|desc` (repeatable)
 * - Pagination: `?page=1&limit=20`
 * - Search: `?q=search+term`
 *
 * Filter operators: eq, neq, gt, gte, lt, lte, between, in, contains, starts, ends
 */
export function parseQuery<TConfig extends QueryFieldConfig | undefined = undefined>(
  query: Record<string, any>,
  fieldConfig?: TConfig,
  options?: ParseQueryOptions,
): TypedParsedQuery<TConfig> {
  const normalized = normalizeFieldConfig(fieldConfig)
  const rejectOpts = options?.onReject ? { onReject: options.onReject } : undefined
  return {
    filters: parseFilters(query.filter, normalized?.filterable, rejectOpts),
    sort: parseSort(query.sort, normalized?.sortable, rejectOpts),
    pagination: parsePagination({ page: query.page, limit: query.limit }, options),
    search: parseSearchQuery(query.q, options),
  } as TypedParsedQuery<TConfig>
}

// ── Query URL builder (for client-side or testing) ──────────────────────

/** Convert ParsedQuery back into query string parameters */
export function buildQueryParams(
  parsed: Partial<ParsedQuery>,
): Record<string, string | string[] | number> {
  const params: Record<string, string | string[] | number> = {}

  if (parsed.filters?.length) {
    params.filter = parsed.filters.map((f) => `${f.field}:${f.operator}:${f.value}`)
  }

  if (parsed.sort?.length) {
    params.sort = parsed.sort.map((s) => `${s.field}:${s.direction}`)
  }

  if (parsed.pagination) {
    params.page = parsed.pagination.page
    params.limit = parsed.pagination.limit
  }

  if (parsed.search) {
    params.q = parsed.search
  }

  return params
}
