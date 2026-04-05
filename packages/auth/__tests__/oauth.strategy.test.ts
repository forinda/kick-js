import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'reflect-metadata'
import { OAuthStrategy } from '@forinda/kickjs-auth'

describe('OAuthStrategy', () => {
  it('creates strategy with pre-configured provider', () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      callbackUrl: 'http://localhost:3000/auth/google/callback',
    })

    expect(strategy.name).toBe('oauth-google')
  })

  it('creates strategy for each built-in provider', () => {
    const providers = ['google', 'github', 'discord', 'microsoft'] as const
    for (const provider of providers) {
      const strategy = new OAuthStrategy({
        provider,
        clientId: 'id',
        clientSecret: 'secret',
        callbackUrl: 'http://localhost/callback',
      })
      expect(strategy.name).toBe(`oauth-${provider}`)
    }
  })

  it('throws when custom provider has no endpoints', () => {
    expect(
      () =>
        new OAuthStrategy({
          provider: 'custom',
          clientId: 'id',
          clientSecret: 'secret',
          callbackUrl: 'http://localhost/callback',
        }),
    ).toThrow('endpoints')
  })

  it('creates custom provider with endpoints', () => {
    const strategy = new OAuthStrategy({
      provider: 'custom',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      endpoints: {
        authorizeUrl: 'https://custom.provider/authorize',
        tokenUrl: 'https://custom.provider/token',
        userInfoUrl: 'https://custom.provider/userinfo',
      },
    })

    expect(strategy.name).toBe('oauth-custom')
  })

  // ── Authorization URL ───────────────────────────────────────────────

  it('generates authorization URL with correct params', () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'my-client-id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost:3000/auth/google/callback',
    })

    const url = strategy.getAuthorizationUrl()
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url).toContain('client_id=my-client-id')
    expect(url).toContain('redirect_uri=http')
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=')
  })

  it('includes state parameter when provided', () => {
    const strategy = new OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const url = strategy.getAuthorizationUrl('csrf-token-123')
    expect(url).toContain('state=csrf-token-123')
  })

  it('allows custom scopes to override provider defaults', () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      scopes: ['email'],
    })

    const url = strategy.getAuthorizationUrl()
    expect(url).toContain('scope=email')
    expect(url).not.toContain('openid')
  })

  // ── Validate (callback) ─────────────────────────────────────────────

  it('returns null when no code in query', async () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const req = { query: {} }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('exchanges code and returns user profile', async () => {
    const strategy = new OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      mapProfile: (profile) => ({
        id: String(profile.id),
        name: profile.login,
        email: profile.email,
        roles: ['user'],
      }),
    })

    // Mock fetch for token exchange and user info
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'gho_test123',
          token_type: 'bearer',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          login: 'testuser',
          email: 'test@github.com',
        }),
      }) as any

    const req = { query: { code: 'auth-code-123' } }
    const user = await strategy.validate(req)

    expect(user).toEqual({
      id: '12345',
      name: 'testuser',
      email: 'test@github.com',
      roles: ['user'],
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)

    globalThis.fetch = originalFetch
  })

  it('returns null when token exchange fails', async () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    }) as any

    const req = { query: { code: 'bad-code' } }
    expect(await strategy.validate(req)).toBeNull()

    globalThis.fetch = originalFetch
  })

  it('returns null when user info fetch fails', async () => {
    const strategy = new OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }) as any

    const req = { query: { code: 'valid-code' } }
    expect(await strategy.validate(req)).toBeNull()

    globalThis.fetch = originalFetch
  })
})
