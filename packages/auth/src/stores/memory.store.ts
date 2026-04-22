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
 * JwtStrategy({
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

  /**
   * Per-user "revoke all" timestamps. Any token for this user issued
   * before this timestamp is considered revoked (checked by `isRevoked`
   * when the token carries a `userId` + `issuedAt`).
   */
  private readonly userRevokedAt = new Map<string, Date>()

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

  /**
   * Check if all tokens for a user were bulk-revoked after a given time.
   * Call this with the token's `iat` (issued-at) claim to check if the
   * user's tokens were revoked after the token was issued.
   *
   * @param userId - The user's ID
   * @param issuedAt - When the token was issued (from JWT `iat` claim)
   * @returns true if the user's tokens were bulk-revoked after issuedAt
   */
  isUserRevoked(userId: string, issuedAt: Date): boolean {
    const revokedAt = this.userRevokedAt.get(userId)
    if (!revokedAt) return false
    return issuedAt < revokedAt
  }

  async revoke(identifier: string, expiresAt?: Date, userId?: string): Promise<void> {
    this.revoked.set(identifier, { expiresAt, userId })
  }

  /**
   * Revoke all tokens for a user by recording a timestamp. Any token
   * issued before this timestamp is considered revoked.
   *
   * Also removes individual revocation entries for this user (cleanup).
   */
  async revokeAllForUser(userId: string): Promise<void> {
    this.userRevokedAt.set(userId, new Date())

    // Clean up individual entries for this user — they're now redundant
    for (const [key, entry] of this.revoked) {
      if (entry.userId === userId) {
        this.revoked.delete(key)
      }
    }
  }

  /**
   * Check if all tokens for a user have been bulk-revoked.
   * Returns the revocation timestamp, or null if not revoked.
   */
  getUserRevokedAt(userId: string): Date | null {
    return this.userRevokedAt.get(userId) ?? null
  }

  async cleanup(): Promise<void> {
    const now = new Date()
    for (const [key, entry] of this.revoked) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.revoked.delete(key)
      }
    }
  }

  /** Number of active individual revocation entries (useful in tests). */
  get size(): number {
    return this.revoked.size
  }
}
