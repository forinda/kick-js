import { randomBytes, createHash } from 'node:crypto'
import { Logger } from '@forinda/kickjs'
import type { AuthStrategy, AuthUser } from '../types'

const log = Logger.for('OAuthStrategy')

/** Generate a cryptographically random code verifier for PKCE */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** Derive the S256 code challenge from a code verifier */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** Supported OAuth providers with pre-configured endpoints */
export type OAuthProvider = 'google' | 'github' | 'discord' | 'microsoft' | 'custom'

/** Provider-specific endpoint configuration */
export interface OAuthEndpoints {
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  /** Scopes to request (space-separated or array) */
  scopes?: string[] | string
}

/** Pre-configured OAuth provider endpoints */
const PROVIDER_ENDPOINTS: Record<Exclude<OAuthProvider, 'custom'>, OAuthEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  discord: {
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile'],
  },
}

export interface OAuthStrategyOptions {
  /** OAuth provider preset or 'custom' for manual endpoint config */
  provider: OAuthProvider

  /** OAuth client ID */
  clientId: string

  /** OAuth client secret */
  clientSecret: string

  /** Callback URL for the OAuth flow (e.g. 'http://localhost:3000/auth/google/callback') */
  callbackUrl: string

  /** Custom endpoints (required when provider is 'custom') */
  endpoints?: OAuthEndpoints

  /** Override default scopes for the provider */
  scopes?: string[]

  /**
   * Transform the provider's user profile into your AuthUser.
   * Called after successfully exchanging the code for a token and fetching user info.
   *
   * @example
   * ```ts
   * mapProfile: (profile) => ({
   *   id: profile.id,
   *   email: profile.email,
   *   name: profile.name,
   *   avatar: profile.picture,
   *   roles: ['user'],
   * })
   * ```
   */
  mapProfile?: (profile: any, tokens: OAuthTokens) => AuthUser | Promise<AuthUser>

  /**
   * Validate the OAuth state parameter on callback to prevent CSRF attacks.
   * Called with the `state` value from the callback query string.
   * Return `true` if the state is valid (matches what you stored in session/cache).
   *
   * When set, `validate()` will reject callbacks with missing or invalid state.
   *
   * @example
   * ```ts
   * stateValidator: async (state, req) => {
   *   const stored = req.session?.data?.oauthState
   *   return !!stored && stored === state
   * }
   * ```
   */
  stateValidator?: (state: string, req: any) => boolean | Promise<boolean>

  /**
   * Enable PKCE (Proof Key for Code Exchange) for the OAuth flow.
   * Recommended for public clients (mobile apps, SPAs) to prevent
   * authorization code interception attacks.
   *
   * When enabled, `getAuthorizationUrl()` returns an object with the URL
   * and a `codeVerifier` that must be stored and passed to `validate()`.
   */
  pkce?: boolean
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresIn?: number
  scope?: string
}

/**
 * Built-in OAuth 2.0 strategy with pre-configured providers.
 * No Passport dependency — KickJS handles the entire OAuth flow.
 *
 * Supports: Google, GitHub, Discord, Microsoft, or any custom OAuth 2.0 provider.
 *
 * This strategy validates the callback request (the one with `?code=...`),
 * exchanges the code for tokens, fetches the user profile, and returns it.
 *
 * You need two routes:
 * 1. **Redirect** — sends user to provider's login page
 * 2. **Callback** — receives the code and authenticates
 *
 * @example
 * ```ts
 * import { OAuthStrategy } from '@forinda/kickjs-auth'
 *
 * const googleAuth = new OAuthStrategy({
 *   provider: 'google',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   callbackUrl: 'http://localhost:3000/auth/google/callback',
 *   mapProfile: (profile) => ({
 *     id: profile.id,
 *     email: profile.email,
 *     name: profile.name,
 *     avatar: profile.picture,
 *     roles: ['user'],
 *   }),
 * })
 *
 * // In your controller:
 * @Get('/auth/google')
 * @Public()
 * loginWithGoogle(ctx: RequestContext) {
 *   return ctx.res.redirect(googleAuth.getAuthorizationUrl())
 * }
 *
 * @Get('/auth/google/callback')
 * @Public()
 * async googleCallback(ctx: RequestContext) {
 *   const user = await googleAuth.validate(ctx.req)
 *   if (!user) return ctx.res.status(401).json({ error: 'Auth failed' })
 *   const token = issueJwt(user)
 *   return ctx.json({ token, user })
 * }
 * ```
 */
export class OAuthStrategy implements AuthStrategy {
  name: string
  private options: OAuthStrategyOptions
  private endpoints: OAuthEndpoints

  constructor(options: OAuthStrategyOptions) {
    this.options = options
    this.name = `oauth-${options.provider}`

    if (options.provider === 'custom') {
      if (!options.endpoints) {
        throw new Error('OAuthStrategy: "endpoints" required when provider is "custom"')
      }
      this.endpoints = options.endpoints
    } else {
      this.endpoints = {
        ...PROVIDER_ENDPOINTS[options.provider],
        ...(options.endpoints ?? {}),
      }
    }

    // Override scopes if provided
    if (options.scopes) {
      this.endpoints.scopes = options.scopes
    }
  }

  /**
   * Get the authorization URL to redirect the user to the OAuth provider.
   * Pass an optional `state` parameter for CSRF protection.
   *
   * When PKCE is enabled, returns an object with the URL and `codeVerifier`.
   * Store the `codeVerifier` in the session — it must be passed to `validate()`.
   *
   * @example
   * ```ts
   * // Without PKCE
   * const url = strategy.getAuthorizationUrl(state)
   * res.redirect(url)
   *
   * // With PKCE
   * const { url, codeVerifier } = strategy.getAuthorizationUrlWithPkce(state)
   * req.session.data.codeVerifier = codeVerifier
   * res.redirect(url)
   * ```
   */
  getAuthorizationUrl(state?: string): string {
    const scopes = Array.isArray(this.endpoints.scopes)
      ? this.endpoints.scopes.join(' ')
      : (this.endpoints.scopes ?? '')

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.callbackUrl,
      response_type: 'code',
      scope: scopes,
      ...(state ? { state } : {}),
    })

    if (this.options.pkce) {
      const verifier = generateCodeVerifier()
      const challenge = generateCodeChallenge(verifier)
      params.set('code_challenge', challenge)
      params.set('code_challenge_method', 'S256')
      // Store verifier — caller must retrieve it from the return value
      // of getAuthorizationUrlWithPkce() instead
    }

    return `${this.endpoints.authorizeUrl}?${params.toString()}`
  }

  /**
   * Get the authorization URL with PKCE support.
   * Returns the URL and the `codeVerifier` that must be stored in session
   * and passed to `validate()` via `req.oauthCodeVerifier`.
   */
  getAuthorizationUrlWithPkce(state?: string): { url: string; codeVerifier: string } {
    const scopes = Array.isArray(this.endpoints.scopes)
      ? this.endpoints.scopes.join(' ')
      : (this.endpoints.scopes ?? '')

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.callbackUrl,
      response_type: 'code',
      scope: scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(state ? { state } : {}),
    })

    return {
      url: `${this.endpoints.authorizeUrl}?${params.toString()}`,
      codeVerifier,
    }
  }

  /**
   * Validate the callback request — exchange the authorization code for
   * tokens and fetch the user profile.
   *
   * When `stateValidator` is configured, the `state` query parameter is
   * validated before proceeding. Callbacks with missing or invalid state
   * are rejected with null.
   *
   * For PKCE flows, pass the stored code verifier via `req.oauthCodeVerifier`.
   */
  async validate(req: any): Promise<AuthUser | null> {
    const code = req.query?.code
    if (!code) return null

    try {
      // Validate state parameter (CSRF protection)
      if (this.options.stateValidator) {
        const state = req.query?.state
        if (!state) {
          log.warn('OAuth callback missing state parameter')
          return null
        }
        const valid = await this.options.stateValidator(state, req)
        if (!valid) {
          log.warn('OAuth callback state validation failed')
          return null
        }
      }

      // Get PKCE code verifier if available
      const codeVerifier = req.oauthCodeVerifier ?? req.session?.data?.oauthCodeVerifier

      // Exchange code for tokens
      const tokens = await this.exchangeCode(code, codeVerifier)
      if (!tokens) return null

      // Fetch user profile
      const profile = await this.fetchUserInfo(tokens.accessToken)
      if (!profile) return null

      // Map profile to AuthUser
      if (this.options.mapProfile) {
        return this.options.mapProfile(profile, tokens)
      }

      return profile
    } catch (err: any) {
      log.error({ err }, `OAuth ${this.options.provider} callback failed`)
      return null
    }
  }

  /** Exchange authorization code for access/refresh tokens */
  private async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens | null> {
    const params: Record<string, string> = {
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.options.callbackUrl,
    }

    // Include PKCE code_verifier if available
    if (codeVerifier) {
      params.code_verifier = codeVerifier
    }

    const body = new URLSearchParams(params)

    const response = await fetch(this.endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      log.error(`Token exchange failed: ${response.status} ${response.statusText}`)
      return null
    }

    const data: any = await response.json()

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type ?? 'Bearer',
      expiresIn: data.expires_in,
      scope: data.scope,
    }
  }

  /** Fetch user profile from the provider's userinfo endpoint */
  private async fetchUserInfo(accessToken: string): Promise<any | null> {
    const response = await fetch(this.endpoints.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      log.error(`User info fetch failed: ${response.status} ${response.statusText}`)
      return null
    }

    return response.json()
  }
}
