import type { AuthUser } from '../types'
import { createAuthStrategy } from './define'

export interface SessionStrategyOptions {
  /**
   * Key in session.data that indicates an authenticated user.
   * If this key is missing or falsy, the session is not authenticated.
   * Default: `'userId'`
   */
  userKey?: string

  /**
   * Resolve the full user object from session data.
   * When not provided, session.data is returned as the AuthUser directly.
   *
   * Use this to look up the user from a database by ID stored in the session.
   *
   * @example
   * ```ts
   * resolveUser: async (sessionData) => {
   *   const user = await db.users.findById(sessionData.userId)
   *   return user ? { id: user.id, email: user.email, roles: user.roles } : null
   * }
   * ```
   */
  resolveUser?: (sessionData: Record<string, any>) => AuthUser | null | Promise<AuthUser | null>
}

/**
 * Session-based authentication strategy.
 *
 * Reads from `req.session` (set by the KickJS session middleware) and
 * checks for an authenticated user via a configurable session key.
 *
 * Requires the session middleware from `@forinda/kickjs`:
 * ```ts
 * import { session } from '@forinda/kickjs'
 * middleware: [session({ secret: process.env.SESSION_SECRET! })]
 * ```
 *
 * @example
 * ```ts
 * // Simple: session.data IS the user
 * SessionStrategy()
 *
 * // With DB lookup
 * SessionStrategy({
 *   userKey: 'userId',
 *   resolveUser: async (data) => db.users.findById(data.userId),
 * })
 * ```
 */
export const SessionStrategy = createAuthStrategy<SessionStrategyOptions>({
  name: 'session',
  defaults: { userKey: 'userId' },
  build: (options) => ({
    async validate(req: any): Promise<AuthUser | null> {
      const session = req.session
      if (!session?.data) return null

      const userKey = options.userKey!
      if (!session.data[userKey]) return null

      if (options.resolveUser) {
        return options.resolveUser(session.data)
      }

      return session.data as AuthUser
    },
  }),
})
