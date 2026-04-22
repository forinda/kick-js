import type { AuthUser } from '../types'
import { createAuthStrategy } from './define'

/**
 * Options for {@link PassportBridge}. The bridge wraps a Passport.js
 * strategy instance under a KickJS-recognised name.
 */
export interface PassportBridgeOptions {
  /**
   * Strategy name surfaced to {@link AuthStrategy.name} — typically the
   * Passport strategy slug (e.g. `'google'`, `'github'`, `'local'`).
   */
  name: string

  /** Passport strategy instance — anything implementing the Passport authenticate contract. */
  strategy: any
}

/**
 * Bridge that wraps any Passport.js strategy into a KickJS AuthStrategy.
 * Lets you use the full Passport ecosystem (500+ strategies) without
 * changing your KickJS auth setup.
 *
 * Requires `passport` as a dependency in your project:
 * ```bash
 * pnpm add passport
 * ```
 *
 * @example
 * ```ts
 * import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
 * import { PassportBridge } from '@forinda/kickjs-auth'
 *
 * const google = PassportBridge({
 *   name: 'google',
 *   strategy: new GoogleStrategy(
 *     {
 *       clientID: process.env.GOOGLE_CLIENT_ID!,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *       callbackURL: '/auth/google/callback',
 *     },
 *     (accessToken, refreshToken, profile, done) => {
 *       const user = await findOrCreateUser(profile)
 *       done(null, user)
 *     },
 *   ),
 * })
 *
 * AuthAdapter({
 *   strategies: [jwtStrategy, google],
 * })
 * ```
 */
export const PassportBridge = createAuthStrategy<PassportBridgeOptions>({
  name: (options) => options.name,
  build: (options) => ({
    validate(req: any): Promise<AuthUser | null> {
      return new Promise((resolve) => {
        // Passport strategies call done(err, user, info). Wrap the
        // authenticate flow manually so we don't require
        // passport.initialize() in the request pipeline.
        const strategy = Object.create(options.strategy)

        strategy.success = (user: any) => resolve(user ?? null)
        strategy.fail = () => resolve(null)
        strategy.error = () => resolve(null)
        strategy.pass = () => resolve(null)
        strategy.redirect = () => resolve(null)

        try {
          strategy.authenticate(req, {})
        } catch {
          resolve(null)
        }
      })
    },
  }),
})
