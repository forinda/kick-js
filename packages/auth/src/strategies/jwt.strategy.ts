import { createPublicKey } from 'node:crypto'
import type { VerifyOptions } from 'jsonwebtoken'
import type { AuthStrategy, AuthUser } from '../types'
import type { TokenStore } from '../token-store'

/**
 * Subset of `jsonwebtoken`'s `VerifyOptions` that `JwtStrategy` forwards
 * to `jwt.verify()`. `algorithms` is excluded because it's already a
 * top-level strategy option (it also drives JWKS key resolution); set
 * it there, not here.
 */
export type JwtVerifyOptions = Omit<VerifyOptions, 'algorithms' | 'complete'>

export interface JwtStrategyOptions {
  /**
   * JWT secret key for HS256 or public key for RS256.
   * Required unless `jwksUri` is provided.
   */
  secret?: string | Buffer

  /**
   * JWKS (JSON Web Key Set) URI for fetching public keys.
   * Used with RS256/RS384/RS512 for providers like Keycloak, Auth0, Okta.
   * Keys are cached and refreshed when a `kid` (key ID) is not found.
   *
   * @example
   * ```ts
   * jwksUri: 'https://keycloak.example.com/realms/my-realm/protocol/openid-connect/certs'
   * ```
   */
  jwksUri?: string

  /**
   * Cache TTL for JWKS keys in milliseconds (default: 600000 = 10 minutes).
   * Set to 0 to disable caching (not recommended in production).
   */
  jwksCacheTtl?: number

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

  /**
   * Optional token revocation store. When provided, every validated
   * token is checked against the store before being accepted.
   */
  tokenStore?: TokenStore

  /**
   * Which identifier to use for revocation lookups.
   * - `'jti'` — use the JWT `jti` claim (recommended, requires tokens to include `jti`)
   * - `'token'` — use the full raw token string
   * Default: `'jti'` with fallback to `'token'` if `jti` claim is missing.
   */
  revokeBy?: 'jti' | 'token'

  /**
   * Resolve a per-tenant JWT secret. When set and `req.tenant` exists,
   * this secret is used instead of the global `secret`.
   * Enables multi-tenant apps to have tenant-isolated JWT signing.
   */
  secretResolver?: (tenantId: string) => string | Buffer | Promise<string | Buffer>

  /**
   * Extra `jsonwebtoken.verify()` options forwarded verbatim. Lets you
   * enforce `issuer` / `audience` / `subject`, set `clockTolerance`, or
   * cap token age via `maxAge` without abusing `mapPayload`.
   *
   * `algorithms` and `complete` are excluded — `algorithms` is already
   * a top-level strategy option, and `complete: true` would break the
   * payload shape the rest of the strategy assumes.
   *
   * @example
   * ```ts
   * new JwtStrategy({
   *   secret: process.env.JWT_SECRET!,
   *   algorithms: ['HS256'],
   *   verifyOptions: {
   *     issuer: process.env.JWT_ISSUER,
   *     audience: process.env.JWT_AUDIENCE,
   *     clockTolerance: 30,
   *     maxAge: '15m',
   *   },
   * })
   * ```
   */
  verifyOptions?: JwtVerifyOptions
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
  private readonly options: JwtStrategyOptions

  /** Cached JWKS keys: kid → PEM public key */
  private jwksCache = new Map<string, string>()
  private jwksCacheTime = 0

  constructor(options: JwtStrategyOptions) {
    if (!options.secret && !options.jwksUri) {
      throw new Error('JwtStrategy requires either "secret" or "jwksUri"')
    }
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
      // Resolve the signing key
      const secret = await this.resolveSecret(token, req)
      if (!secret) return null

      // Default to RS256 when using JWKS, HS256 when using static secret
      const defaultAlgorithms = this.options.jwksUri ? ['RS256'] : ['HS256']

      const payload = this.jwt.verify(token, secret, {
        ...this.options.verifyOptions,
        algorithms: this.options.algorithms ?? defaultAlgorithms,
      })

      // Check token revocation if a store is configured
      if (this.options.tokenStore) {
        const revokeBy = this.options.revokeBy ?? 'jti'
        const identifier = revokeBy === 'jti' && payload.jti ? payload.jti : token
        if (await this.options.tokenStore.isRevoked(identifier)) {
          return null
        }
      }

      return this.options.mapPayload ? this.options.mapPayload(payload) : payload
    } catch {
      return null
    }
  }

  /**
   * Resolve the signing key for a token.
   * Priority: secretResolver (per-tenant) > jwksUri (by kid) > static secret
   */
  private async resolveSecret(token: string, req: any): Promise<string | Buffer | null> {
    // Per-tenant secret resolver takes precedence
    if (this.options.secretResolver && req.tenant?.id) {
      return this.options.secretResolver(req.tenant.id)
    }

    // JWKS URI: decode header to get kid, fetch matching key
    if (this.options.jwksUri) {
      const header = this.decodeHeader(token)
      if (!header?.kid) return null
      return this.getJwksKey(header.kid)
    }

    return this.options.secret ?? null
  }

  /**
   * Decode the JWT header without verification to extract the `kid`.
   */
  private decodeHeader(token: string): { kid?: string; alg?: string } | null {
    try {
      const headerB64 = token.split('.')[0]
      if (!headerB64) return null
      return JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'))
    } catch {
      return null
    }
  }

  /**
   * Get a public key from the JWKS cache by `kid`. If the key is not
   * cached or the cache has expired, fetches fresh keys from the JWKS URI.
   * If the kid is still not found after refresh, returns null.
   */
  private async getJwksKey(kid: string): Promise<string | null> {
    const ttl = this.options.jwksCacheTtl ?? 600_000

    // Check cache
    if (this.jwksCache.has(kid) && Date.now() - this.jwksCacheTime < ttl) {
      return this.jwksCache.get(kid)!
    }

    // Fetch and cache
    await this.refreshJwks()

    return this.jwksCache.get(kid) ?? null
  }

  /**
   * Fetch the JWKS from the configured URI and cache all keys.
   * Converts JWK RSA keys to PEM format for jsonwebtoken compatibility.
   */
  private async refreshJwks(): Promise<void> {
    if (!this.options.jwksUri) return

    try {
      const res = await fetch(this.options.jwksUri, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) return

      const data = (await res.json()) as { keys?: JwkKey[] }
      if (!data.keys) return

      this.jwksCache.clear()
      for (const key of data.keys) {
        if (key.kid && key.kty === 'RSA' && key.n && key.e) {
          this.jwksCache.set(key.kid, jwkToPem(key))
        }
      }
      this.jwksCacheTime = Date.now()
    } catch {
      // JWKS fetch failure — keep stale cache if available
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

// ── JWK Utilities ──────────────────────────────────────────────────────

interface JwkKey {
  kid?: string
  kty: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

/**
 * Convert an RSA JWK to PEM format using Node's crypto module.
 * This avoids external dependencies like `jwk-to-pem`.
 */
function jwkToPem(jwk: JwkKey): string {
  const key = createPublicKey({
    key: { kty: jwk.kty, n: jwk.n!, e: jwk.e! },
    format: 'jwk',
  })
  return key.export({ type: 'spki', format: 'pem' }) as string
}

// ── Keycloak Helpers ───────────────────────────────────────────────────

export interface KeycloakMapOptions {
  /**
   * Keycloak client ID — used to extract client-specific roles from
   * `resource_access[clientId].roles`.
   */
  clientId: string
  /** Include realm-level roles from `realm_access.roles` (default: true) */
  includeRealmRoles?: boolean
  /** Include client-specific roles from `resource_access[clientId].roles` (default: true) */
  includeClientRoles?: boolean
  /**
   * Prefix roles with their source: `'realm:admin'`, `'client:editor'`.
   * Useful when realm and client roles overlap. Default: false.
   */
  rolePrefix?: boolean
}

/**
 * Create a `mapPayload` function that extracts Keycloak's nested role
 * structure into a flat `AuthUser.roles` array.
 *
 * Keycloak JWTs store roles in:
 * - `realm_access.roles` — global realm roles
 * - `resource_access[clientId].roles` — per-client roles
 *
 * @example
 * ```ts
 * import { JwtStrategy, keycloakMapPayload } from '@forinda/kickjs-auth'
 *
 * new JwtStrategy({
 *   jwksUri: 'https://keycloak.example.com/realms/my-realm/protocol/openid-connect/certs',
 *   mapPayload: keycloakMapPayload({ clientId: 'my-app' }),
 * })
 * ```
 */
export function keycloakMapPayload(options: KeycloakMapOptions): (payload: any) => AuthUser {
  const {
    clientId,
    includeRealmRoles = true,
    includeClientRoles = true,
    rolePrefix = false,
  } = options

  return (payload: any): AuthUser => {
    const roles: string[] = []

    if (includeRealmRoles && payload.realm_access?.roles) {
      for (const role of payload.realm_access.roles) {
        roles.push(rolePrefix ? `realm:${role}` : role)
      }
    }

    if (includeClientRoles && payload.resource_access?.[clientId]?.roles) {
      for (const role of payload.resource_access[clientId].roles) {
        roles.push(rolePrefix ? `client:${role}` : role)
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.preferred_username,
      emailVerified: payload.email_verified,
      roles,
    }
  }
}
