import type { AuthStrategy, AuthUser } from '../types'

export interface JwtStrategyOptions {
  /** JWT secret key for HS256 or public key for RS256 */
  secret: string | Buffer

  /**
   * Algorithm (default: 'HS256').
   * Common values: 'HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512'
   */
  algorithms?: string[]

  /** Where to read the token from (default: 'header') */
  tokenFrom?: 'header' | 'query' | 'cookie'

  /** Header name (default: 'authorization') */
  headerName?: string

  /** Query parameter name when tokenFrom='query' (default: 'token') */
  queryParam?: string

  /** Cookie name when tokenFrom='cookie' (default: 'jwt') */
  cookieName?: string

  /** Token prefix in header (default: 'Bearer') */
  headerPrefix?: string

  /**
   * Transform the decoded JWT payload into your AuthUser shape.
   * By default, returns the payload as-is.
   *
   * @example
   * ```ts
   * mapPayload: (payload) => ({
   *   id: payload.sub,
   *   email: payload.email,
   *   roles: payload.roles || [],
   * })
   * ```
   */
  mapPayload?: (payload: any) => AuthUser
}

/**
 * JWT authentication strategy.
 * Validates Bearer tokens using `jsonwebtoken`.
 *
 * Requires `jsonwebtoken` as a peer dependency:
 * ```bash
 * pnpm add jsonwebtoken @types/jsonwebtoken
 * ```
 *
 * @example
 * ```ts
 * new JwtStrategy({
 *   secret: process.env.JWT_SECRET!,
 *   mapPayload: (payload) => ({
 *     id: payload.sub,
 *     email: payload.email,
 *     roles: payload.roles ?? ['user'],
 *   }),
 * })
 * ```
 */
export class JwtStrategy implements AuthStrategy {
  name = 'jwt'
  private jwt: any
  private options: JwtStrategyOptions

  constructor(options: JwtStrategyOptions) {
    this.options = options
  }

  private async ensureJwt(): Promise<void> {
    if (this.jwt) return
    try {
      const mod: any = await import('jsonwebtoken')
      this.jwt = mod.default ?? mod
    } catch {
      throw new Error('JwtStrategy requires "jsonwebtoken" package. Install: pnpm add jsonwebtoken')
    }
  }

  async validate(req: any): Promise<AuthUser | null> {
    await this.ensureJwt()

    const token = this.extractToken(req)
    if (!token) return null

    try {
      const payload = this.jwt.verify(token, this.options.secret, {
        algorithms: this.options.algorithms ?? ['HS256'],
      })

      return this.options.mapPayload ? this.options.mapPayload(payload) : payload
    } catch {
      return null
    }
  }

  private extractToken(req: any): string | null {
    const from = this.options.tokenFrom ?? 'header'

    if (from === 'header') {
      const headerName = this.options.headerName ?? 'authorization'
      const prefix = this.options.headerPrefix ?? 'Bearer'
      const header = req.headers?.[headerName] ?? req.headers?.[headerName.toLowerCase()]
      if (!header || typeof header !== 'string') return null
      if (!header.startsWith(`${prefix} `)) return null
      return header.slice(prefix.length + 1)
    }

    if (from === 'query') {
      const param = this.options.queryParam ?? 'token'
      return req.query?.[param] ?? null
    }

    if (from === 'cookie') {
      const cookieName = this.options.cookieName ?? 'jwt'
      return req.cookies?.[cookieName] ?? null
    }

    return null
  }
}
