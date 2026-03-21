import type { AuthStrategy, AuthUser } from '../types'

export interface ApiKeyUser {
  /** Display name for the API key holder */
  name: string
  /** Roles granted to this API key */
  roles?: string[]
  /** Additional metadata */
  [key: string]: any
}

export interface ApiKeyStrategyOptions {
  /**
   * Map of API keys to their associated users.
   * Keys are the raw API key strings.
   *
   * @example
   * ```ts
   * keys: {
   *   'sk-live-abc123': { name: 'Production Bot', roles: ['api', 'write'] },
   *   'sk-test-xyz789': { name: 'Test Runner', roles: ['api'] },
   * }
   * ```
   */
  keys?: Record<string, ApiKeyUser>

  /**
   * Async function to validate an API key.
   * Use when keys are stored in a database or external service.
   * Takes precedence over the static `keys` map.
   *
   * @example
   * ```ts
   * validate: async (key) => {
   *   const row = await db.apiKeys.findUnique({ where: { key } })
   *   if (!row || row.revokedAt) return null
   *   return { name: row.name, roles: row.roles }
   * }
   * ```
   */
  validate?: (key: string) => Promise<AuthUser | null> | AuthUser | null

  /**
   * Where to read the API key from (default: 'header').
   * Checks all specified locations in order.
   */
  from?: Array<'header' | 'query'>

  /** Header name (default: 'x-api-key') */
  headerName?: string

  /** Query parameter name (default: 'api_key') */
  queryParam?: string
}

/**
 * API key authentication strategy.
 * Validates keys from headers or query parameters against a static map
 * or async validator function.
 *
 * @example
 * ```ts
 * // Static keys
 * new ApiKeyStrategy({
 *   keys: {
 *     'sk-prod-123': { name: 'CI Bot', roles: ['api'] },
 *   },
 * })
 *
 * // Database lookup
 * new ApiKeyStrategy({
 *   validate: async (key) => {
 *     const record = await db.apiKeys.findByKey(key)
 *     return record ? { name: record.name, roles: record.roles } : null
 *   },
 * })
 * ```
 */
export class ApiKeyStrategy implements AuthStrategy {
  name = 'api-key'
  private options: ApiKeyStrategyOptions

  constructor(options: ApiKeyStrategyOptions) {
    this.options = options
  }

  async validate(req: any): Promise<AuthUser | null> {
    const key = this.extractKey(req)
    if (!key) return null

    // Async validator takes precedence
    if (this.options.validate) {
      return this.options.validate(key)
    }

    // Static key lookup
    if (this.options.keys) {
      const user = this.options.keys[key]
      return user ?? null
    }

    return null
  }

  private extractKey(req: any): string | null {
    const sources = this.options.from ?? ['header']

    for (const source of sources) {
      if (source === 'header') {
        const headerName = this.options.headerName ?? 'x-api-key'
        const value = req.headers?.[headerName] ?? req.headers?.[headerName.toLowerCase()]
        if (value && typeof value === 'string') return value
      }

      if (source === 'query') {
        const param = this.options.queryParam ?? 'api_key'
        const value = req.query?.[param]
        if (value && typeof value === 'string') return value
      }
    }

    return null
  }
}
