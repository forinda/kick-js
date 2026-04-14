import type { TokenStore } from '../token-store'

interface RevocationEntry {
  userId?: string
  expiresAt?: Date
}

/**
 * In-memory token revocation store for development and testing.
 *
 * **Not suitable for production** — revocation state is lost on restart
 * and not shared across processes. Use a Redis or database-backed
 * `TokenStore` implementation for production deployments.
 *
 * @example
 * ```ts
 * import { JwtStrategy, MemoryTokenStore } from '@forinda/kickjs-auth'
 *
 * const tokenStore = new MemoryTokenStore()
 *
 * new JwtStrategy({
 *   secret: process.env.JWT_SECRET!,
 *   tokenStore,
 * })
 *
 * // Revoke a token on logout
 * await tokenStore.revoke(jti, new Date(payload.exp * 1000))
 * ```
 */
export class MemoryTokenStore implements TokenStore {
  private readonly revoked = new Map<string, RevocationEntry>()

  async isRevoked(identifier: string): Promise<boolean> {
    const entry = this.revoked.get(identifier)
    if (!entry) return false

    // Auto-purge expired revocation entries
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.revoked.delete(identifier)
      return false
    }

    return true
  }

  async revoke(identifier: string, expiresAt?: Date, userId?: string): Promise<void> {
    this.revoked.set(identifier, { expiresAt, userId })
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const [key, entry] of this.revoked) {
      if (entry.userId === userId) {
        this.revoked.delete(key)
      }
    }
  }

  async cleanup(): Promise<void> {
    const now = new Date()
    for (const [key, entry] of this.revoked) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.revoked.delete(key)
      }
    }
  }

  /** Number of active revocation entries (useful in tests). */
  get size(): number {
    return this.revoked.size
  }
}
