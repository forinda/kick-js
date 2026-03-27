import { FILTER_OPERATORS, } from './types';
const MAX_SEARCH_LENGTH = 200;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// ── Individual parsers ──────────────────────────────────────────────────
/** Parse filter strings like "status:eq:active" into structured objects */
export function parseFilters(filterParam, allowedFields) {
    if (!filterParam)
        return [];
    const items = Array.isArray(filterParam) ? filterParam : [filterParam];
    const results = [];
    const allowed = allowedFields ? new Set(allowedFields) : null;
    for (const item of items) {
        // Split on first two colons only — value may contain colons (e.g. timestamps)
        const firstColon = item.indexOf(':');
        if (firstColon === -1)
            continue;
        const secondColon = item.indexOf(':', firstColon + 1);
        if (secondColon === -1)
            continue;
        const field = item.slice(0, firstColon);
        const operator = item.slice(firstColon + 1, secondColon);
        const value = item.slice(secondColon + 1);
        if (!field || !value)
            continue;
        if (!FILTER_OPERATORS.has(operator))
            continue;
        if (allowed && !allowed.has(field))
            continue;
        results.push({ field, operator: operator, value });
    }
    return results;
}
/** Parse sort strings like "firstName:asc" into structured objects */
export function parseSort(sortParam, allowedFields) {
    if (!sortParam)
        return [];
    const items = Array.isArray(sortParam) ? sortParam : [sortParam];
    const results = [];
    const allowed = allowedFields ? new Set(allowedFields) : null;
    for (const item of items) {
        // Split on last colon so field names with colons work
        const lastColon = item.lastIndexOf(':');
        if (lastColon === -1)
            continue;
        const field = item.slice(0, lastColon);
        const dir = item.slice(lastColon + 1).toLowerCase();
        if (!field)
            continue;
        if (dir !== 'asc' && dir !== 'desc')
            continue;
        if (allowed && !allowed.has(field))
            continue;
        results.push({ field, direction: dir });
    }
    return results;
}
/** Parse page/limit into pagination with computed offset */
export function parsePagination(params) {
    let page = typeof params.page === 'string' ? parseInt(params.page, 10) : (params.page ?? DEFAULT_PAGE);
    let limit = typeof params.limit === 'string' ? parseInt(params.limit, 10) : (params.limit ?? DEFAULT_LIMIT);
    if (isNaN(page) || page < 1)
        page = DEFAULT_PAGE;
    if (isNaN(limit) || limit < 1)
        limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT)
        limit = MAX_LIMIT;
    return { page, limit, offset: (page - 1) * limit };
}
/** Sanitize and truncate search query */
export function parseSearchQuery(q) {
    if (!q)
        return '';
    return q.trim().slice(0, MAX_SEARCH_LENGTH);
}
// ── Config normalizer ───────────────────────────────────────────────────
/**
 * Normalize a QueryFieldConfig into the string-based form.
 * Detects column-object-based configs (DrizzleQueryParamsConfig) by checking
 * for a `columns` property and extracts `Object.keys()`.
 */
function normalizeFieldConfig(config) {
    if (!config)
        return undefined;
    // Column-object-based config (e.g., DrizzleQueryParamsConfig)
    if ('columns' in config && config.columns && typeof config.columns === 'object') {
        return {
            filterable: Object.keys(config.columns),
            sortable: config.sortable ? Object.keys(config.sortable) : undefined,
            searchable: undefined, // searchColumns are Column objects, not used for string filtering
        };
    }
    // Already string-based
    return config;
}
// ── Combined parser ─────────────────────────────────────────────────────
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
export function parseQuery(query, fieldConfig) {
    const normalized = normalizeFieldConfig(fieldConfig);
    return {
        filters: parseFilters(query.filter, normalized?.filterable),
        sort: parseSort(query.sort, normalized?.sortable),
        pagination: parsePagination({ page: query.page, limit: query.limit }),
        search: parseSearchQuery(query.q),
    };
}
// ── Query URL builder (for client-side or testing) ──────────────────────
/** Convert ParsedQuery back into query string parameters */
export function buildQueryParams(parsed) {
    const params = {};
    if (parsed.filters?.length) {
        params.filter = parsed.filters.map((f) => `${f.field}:${f.operator}:${f.value}`);
    }
    if (parsed.sort?.length) {
        params.sort = parsed.sort.map((s) => `${s.field}:${s.direction}`);
    }
    if (parsed.pagination) {
        params.page = parsed.pagination.page;
        params.limit = parsed.pagination.limit;
    }
    if (parsed.search) {
        params.q = parsed.search;
    }
    return params;
}
//# sourceMappingURL=parse-query.js.map