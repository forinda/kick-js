/**
 * Pluggable token revocation store.
 *
 * Implement this interface to back JWT/API key revocation with
 * Redis, a database, or any external store. The framework ships
 * `MemoryTokenStore` for development and testing.
 *
 * @example
 * ```ts
 * class RedisTokenStore implements TokenStore {
 *   constructor(private redis: Redis) {}
 *
 *   async isRevoked(id: string) {
 *     return !!(await this.redis.get(`revoked:${id}`))
 *   }
 *
 *   async revoke(id: string, expiresAt?: Date) {
 *     const ttl = expiresAt
 *       ? Math.ceil((expiresAt.getTime() - Date.now()) / 1000)
 *       : 86400
 *     await this.redis.set(`revoked:${id}`, '1', 'EX', ttl)
 *   }
 *
 *   async revokeAllForUser(userId: string) {
 *     const keys = await this.redis.keys(`revoked:user:${userId}:*`)
 *     if (keys.length) await this.redis.del(...keys)
 *   }
 * }
 * ```
 */
export interface TokenStore {
  /** Check if a token identifier has been revoked. */
  isRevoked(identifier: string): Promise<boolean>

  /**
   * Revoke a token. The optional `expiresAt` allows the store to
   * auto-purge entries after the token's natural expiry.
   */
  revoke(identifier: string, expiresAt?: Date): Promise<void>

  /** Revoke all tokens belonging to a user (e.g., on password change). */
  revokeAllForUser(userId: string): Promise<void>

  /** Remove expired revocation entries. Called periodically or on demand. */
  cleanup?(): Promise<void>
}
