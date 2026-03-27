/**
 * Normalize a URL path segment:
 * - '/' or '' or undefined → ''
 * - Ensures leading '/' if non-empty
 * - Strips trailing '/'
 * - Collapses consecutive '//' into single '/'
 */
export function normalizePath(path) {
    let p = path?.trim() || '';
    if (p === '/')
        return '';
    if (p && !p.startsWith('/'))
        p = `/${p}`;
    // Strip trailing slash
    p = p.replace(/\/+$/, '');
    // Collapse double slashes
    p = p.replace(/\/\/+/g, '/');
    return p;
}
/**
 * Join path segments into a single normalized path.
 * Handles leading/trailing slashes and prevents double slashes.
 *
 * @example
 * joinPaths('/api/v1', '/users')    // '/api/v1/users'
 * joinPaths('/api/v1/', '/users')   // '/api/v1/users'
 * joinPaths('/api/v1', '/')         // '/api/v1'
 * joinPaths('/api/v1', '')          // '/api/v1'
 * joinPaths('/api/v1', 'users')     // '/api/v1/users'
 */
export function joinPaths(...segments) {
    const joined = segments
        .map((s) => s?.trim() || '')
        .filter(Boolean)
        .join('/');
    // Ensure leading slash, collapse doubles
    const normalized = ('/' + joined).replace(/\/\/+/g, '/');
    // Strip trailing slash (unless it's just '/')
    return normalized === '/' ? '/' : normalized.replace(/\/+$/, '');
}
//# sourceMappingURL=path.js.map