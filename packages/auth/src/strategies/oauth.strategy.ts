import { randomBytes, createHash } from 'node:crypto'
import { Logger } from '@forinda/kickjs'
import type { AuthUser } from '../types'
import { createAuthStrategy } from './define'

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
 * Public methods exposed by an OAuth strategy beyond the standard
 * {@link AuthStrategy.validate} contract — `getAuthorizationUrl` and
 * `getAuthorizationUrlWithPkce` are called from controllers to build
 * the redirect URL the user follows to the provider's login page.
 */
export interface OAuthStrategyExtensions {
  /**
   * Get the authorization URL to redirect the user to the OAuth provider.
   * Pass an optional `state` parameter for CSRF protection.
   */
  getAuthorizationUrl(state?: string): string

  /**
   * Get the authorization URL with PKCE support. Returns the URL and the
   * `codeVerifier` that must be stored in session and passed to
   * `validate()` via `req.oauthCodeVerifier`.
   */
  getAuthorizationUrlWithPkce(state?: string): { url: string; codeVerifier: string }
}

/**
 * Built-in OAuth 2.0 strategy with pre-configured providers.
 * No Passport dependency — KickJS handles the entire OAuth flow.
 *
 * Supports: Google, GitHub, Discord, Microsoft, or any custom OAuth 2.0 provider.
 *
 * The strategy validates the callback request (the one with `?code=...`),
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
 * const googleAuth = OAuthStrategy({
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
export const OAuthStrategy = createAuthStrategy<OAuthStrategyOptions, OAuthStrategyExtensions>({
  // Dynamic name preserves the historic `oauth-google` / `oauth-github` /
  // `oauth-custom` shape so AuthAdapter strategy matching keeps working
  // unchanged across the migration.
  name: (options) => `oauth-${options.provider}`,
  build: (options) => {
    let endpoints: OAuthEndpoints

    if (options.provider === 'custom') {
      if (!options.endpoints) {
        throw new Error('OAuthStrategy: "endpoints" required when provider is "custom"')
      }
      endpoints = options.endpoints
    } else {
      endpoints = {
        ...PROVIDER_ENDPOINTS[options.provider],
        ...(options.endpoints ?? {}),
      }
    }

    if (options.scopes) {
      endpoints.scopes = options.scopes
    }

    const exchangeCode = async (
      code: string,
      codeVerifier?: string,
    ): Promise<OAuthTokens | null> => {
      const params: Record<string, string> = {
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: options.callbackUrl,
      }

      if (codeVerifier) {
        params.code_verifier = codeVerifier
      }

      const body = new URLSearchParams(params)

      const response = await fetch(endpoints.tokenUrl, {
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

    const fetchUserInfo = async (accessToken: string): Promise<any | null> => {
      const response = await fetch(endpoints.userInfoUrl, {
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

    const buildAuthorizeUrl = (state: string | undefined, pkceChallenge?: string): string => {
      const scopes = Array.isArray(endpoints.scopes)
        ? endpoints.scopes.join(' ')
        : (endpoints.scopes ?? '')

      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.callbackUrl,
        response_type: 'code',
        scope: scopes,
        ...(state ? { state } : {}),
        ...(pkceChallenge ? { code_challenge: pkceChallenge, code_challenge_method: 'S256' } : {}),
      })

      return `${endpoints.authorizeUrl}?${params.toString()}`
    }

    return {
      async validate(req: any): Promise<AuthUser | null> {
        const code = req.query?.code
        if (!code) return null

        try {
          // Validate state parameter (CSRF protection)
          if (options.stateValidator) {
            const state = req.query?.state
            if (!state) {
              log.warn('OAuth callback missing state parameter')
              return null
            }
            const valid = await options.stateValidator(state, req)
            if (!valid) {
              log.warn('OAuth callback state validation failed')
              return null
            }
          }

          // Get PKCE code verifier if available
          const codeVerifier = req.oauthCodeVerifier ?? req.session?.data?.oauthCodeVerifier

          // Exchange code for tokens
          const tokens = await exchangeCode(code, codeVerifier)
          if (!tokens) return null

          // Fetch user profile
          const profile = await fetchUserInfo(tokens.accessToken)
          if (!profile) return null

          // Map profile to AuthUser
          if (options.mapProfile) {
            return options.mapProfile(profile, tokens)
          }

          return profile
        } catch (err: any) {
          log.error({ err }, `OAuth ${options.provider} callback failed`)
          return null
        }
      },

      getAuthorizationUrl(state?: string): string {
        if (options.pkce) {
          // Bare getAuthorizationUrl with pkce=true emits a challenge but
          // throws away the verifier — callers that need to pair the
          // verifier with the callback should use getAuthorizationUrlWithPkce.
          const verifier = generateCodeVerifier()
          const challenge = generateCodeChallenge(verifier)
          return buildAuthorizeUrl(state, challenge)
        }
        return buildAuthorizeUrl(state)
      },

      getAuthorizationUrlWithPkce(state?: string): { url: string; codeVerifier: string } {
        const codeVerifier = generateCodeVerifier()
        const codeChallenge = generateCodeChallenge(codeVerifier)
        return {
          url: buildAuthorizeUrl(state, codeChallenge),
          codeVerifier,
        }
      },
    }
  },
})
