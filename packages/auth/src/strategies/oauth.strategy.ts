import { Logger } from '@forinda/kickjs'
import type { AuthStrategy, AuthUser } from '../types'

const log = Logger.for('OAuthStrategy')

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

    return `${this.endpoints.authorizeUrl}?${params.toString()}`
  }

  /**
   * Validate the callback request — exchange the authorization code for
   * tokens and fetch the user profile.
   */
  async validate(req: any): Promise<AuthUser | null> {
    const code = req.query?.code
    if (!code) return null

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCode(code)
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
  private async exchangeCode(code: string): Promise<OAuthTokens | null> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.options.callbackUrl,
    })

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
