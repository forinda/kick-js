import type { AuthStrategy, AuthUser } from '../types'

/**
 * Bridge that wraps any Passport.js strategy into a KickJS AuthStrategy.
 * This lets you use the full Passport ecosystem (500+ strategies) without
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
 * const google = new PassportBridge('google', new GoogleStrategy({
 *   clientID: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   callbackURL: '/auth/google/callback',
 * }, (accessToken, refreshToken, profile, done) => {
 *   // Find or create user from profile
 *   const user = await findOrCreateUser(profile)
 *   done(null, user)
 * }))
 *
 * new AuthAdapter({
 *   strategies: [jwtStrategy, google],
 * })
 * ```
 */
export class PassportBridge implements AuthStrategy {
  name: string
  private passportStrategy: any

  constructor(name: string, passportStrategy: any) {
    this.name = name
    this.passportStrategy = passportStrategy
  }

  validate(req: any): Promise<AuthUser | null> {
    return new Promise((resolve) => {
      // Passport strategies call done(err, user, info)
      // We wrap the authenticate flow manually without needing passport.initialize()
      const strategy = Object.create(this.passportStrategy)

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
  }
}
