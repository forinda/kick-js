/**
 * Normalize a URL path segment:
 * - '/' or '' or undefined → ''
 * - Ensures leading '/' if non-empty
 * - Strips trailing '/'
 * - Collapses consecutive '//' into single '/'
 */
export function normalizePath(path?: string): string {
  let p = path?.trim() || ''
  if (p === '/') return ''
  if (p && !p.startsWith('/')) p = `/${p}`
  // Strip trailing slash
  p = p.replace(/\/+$/, '')
  // Collapse double slashes
  p = p.replace(/\/\/+/g, '/')
  return p
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
export function joinPaths(...segments: (string | undefined)[]): string {
  const joined = segments
    .map((s) => s?.trim() || '')
    .filter(Boolean)
    .join('/')
  // Ensure leading slash, collapse doubles
  const normalized = ('/' + joined).replace(/\/\/+/g, '/')
  // Strip trailing slash (unless it's just '/')
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '')
}

/**
 * Mount path for a module's routes: `{apiPrefix}/v{version}{path}`.
 *
 * `version: false` drops the `/v{n}` segment entirely — opting out of URL
 * versioning without giving up the prefix. Both mount sites (the node
 * `Application` and the web `createWebApp`) go through here so the two
 * cannot drift.
 */
export function buildMountPath(apiPrefix: string, version: number | false, path?: string): string {
  return joinPaths(apiPrefix, version === false ? undefined : `v${version}`, normalizePath(path))
}
