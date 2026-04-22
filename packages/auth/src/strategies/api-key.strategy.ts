import type { AuthUser } from '../types'
import type { TokenStore } from '../token-store'
import { createAuthStrategy } from './define'

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

  /**
   * Optional token revocation store. When provided, every API key is
   * checked against the store before being accepted.
   */
  tokenStore?: TokenStore
}

const extractKey = (req: any, options: ApiKeyStrategyOptions): string | null => {
  const sources = options.from ?? ['header']

  for (const source of sources) {
    if (source === 'header') {
      const headerName = options.headerName!
      const value = req.headers?.[headerName] ?? req.headers?.[headerName.toLowerCase()]
      if (value && typeof value === 'string') return value
    }

    if (source === 'query') {
      const param = options.queryParam!
      const value = req.query?.[param]
      if (value && typeof value === 'string') return value
    }
  }

  return null
}

/**
 * API key authentication strategy.
 * Validates keys from headers or query parameters against a static map
 * or async validator function.
 *
 * @example
 * ```ts
 * // Static keys
 * ApiKeyStrategy({
 *   keys: {
 *     'sk-prod-123': { name: 'CI Bot', roles: ['api'] },
 *   },
 * })
 *
 * // Database lookup
 * ApiKeyStrategy({
 *   validate: async (key) => {
 *     const record = await db.apiKeys.findByKey(key)
 *     return record ? { name: record.name, roles: record.roles } : null
 *   },
 * })
 *
 * // Multi-realm via .scoped()
 * ApiKeyStrategy.scoped('admin', { keys: adminKeys, headerName: 'x-admin-key' })
 * ```
 */
export const ApiKeyStrategy = createAuthStrategy<ApiKeyStrategyOptions>({
  name: 'api-key',
  defaults: {
    headerName: 'x-api-key',
    queryParam: 'api_key',
  },
  build: (options) => ({
    async validate(req: any): Promise<AuthUser | null> {
      const key = extractKey(req, options)
      if (!key) return null

      // Check revocation before validating
      if (options.tokenStore) {
        if (await options.tokenStore.isRevoked(key)) {
          return null
        }
      }

      // Async validator takes precedence
      if (options.validate) {
        return options.validate(key)
      }

      // Static key lookup
      if (options.keys) {
        const user = options.keys[key]
        return user ?? null
      }

      return null
    },
  }),
})
