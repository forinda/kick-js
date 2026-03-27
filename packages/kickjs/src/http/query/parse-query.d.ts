import { type FilterItem, type SortItem, type PaginationParams, type ParsedQuery, type QueryFieldConfig } from './types';
/** Parse filter strings like "status:eq:active" into structured objects */
export declare function parseFilters(filterParam: string | string[] | undefined, allowedFields?: string[]): FilterItem[];
/** Parse sort strings like "firstName:asc" into structured objects */
export declare function parseSort(sortParam: string | string[] | undefined, allowedFields?: string[]): SortItem[];
/** Parse page/limit into pagination with computed offset */
export declare function parsePagination(params: {
    page?: string | number;
    limit?: string | number;
}): PaginationParams;
/** Sanitize and truncate search query */
export declare function parseSearchQuery(q: string | undefined): string;
/**
 * Parse a raw Express query object into a structured, ORM-agnostic ParsedQuery.
 *
 * @param query - Raw query string object from `req.query` or Zod-validated object
 * @param fieldConfig - Optional field restrictions (whitelist filterable/sortable/searchable).
 *   Accepts both string-based configs (`{ filterable, sortable, searchable }`) and
 *   column-object configs (`{ columns, sortable, searchColumns }`).
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
export declare function parseQuery(query: Record<string, any>, fieldConfig?: QueryFieldConfig): ParsedQuery;
/** Convert ParsedQuery back into query string parameters */
export declare function buildQueryParams(parsed: Partial<ParsedQuery>): Record<string, string | string[] | number>;
//# sourceMappingURL=parse-query.d.ts.map