/**
 * Normalize a URL path segment:
 * - '/' or '' or undefined → ''
 * - Ensures leading '/' if non-empty
 * - Strips trailing '/'
 * - Collapses consecutive '//' into single '/'
 */
export declare function normalizePath(path?: string): string;
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
export declare function joinPaths(...segments: (string | undefined)[]): string;
//# sourceMappingURL=path.d.ts.map