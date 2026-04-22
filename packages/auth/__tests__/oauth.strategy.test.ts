import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'reflect-metadata'
import { OAuthStrategy } from '@forinda/kickjs-auth'

describe('OAuthStrategy', () => {
  it('creates strategy with pre-configured provider', () => {
    const strategy = OAuthStrategy({
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
      const strategy = OAuthStrategy({
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
        OAuthStrategy({
          provider: 'custom',
          clientId: 'id',
          clientSecret: 'secret',
          callbackUrl: 'http://localhost/callback',
        }),
    ).toThrow('endpoints')
  })

  it('creates custom provider with endpoints', () => {
    const strategy = OAuthStrategy({
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
    const strategy = OAuthStrategy({
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
    const strategy = OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const url = strategy.getAuthorizationUrl('csrf-token-123')
    expect(url).toContain('state=csrf-token-123')
  })

  it('allows custom scopes to override provider defaults', () => {
    const strategy = OAuthStrategy({
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
    const strategy = OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
    })

    const req = { query: {} }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('exchanges code and returns user profile', async () => {
    const strategy = OAuthStrategy({
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
    const strategy = OAuthStrategy({
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
    const strategy = OAuthStrategy({
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

  // ── State Validation (CSRF) ─────────────────────────────────────────

  it('rejects callback when stateValidator is set and state is missing', async () => {
    const strategy = OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      stateValidator: () => true,
    })

    const req = { query: { code: 'valid-code' } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('rejects callback when stateValidator returns false', async () => {
    const strategy = OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      stateValidator: (state) => state === 'expected-state',
    })

    const req = { query: { code: 'valid-code', state: 'wrong-state' } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('proceeds when stateValidator returns true', async () => {
    const strategy = OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      stateValidator: (state) => state === 'valid-state',
      mapProfile: (profile) => ({
        id: String(profile.id),
        roles: ['user'],
      }),
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1 }),
      }) as any

    const req = { query: { code: 'auth-code', state: 'valid-state' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ id: '1', roles: ['user'] })

    globalThis.fetch = originalFetch
  })

  it('supports async stateValidator', async () => {
    const strategy = OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      stateValidator: async (state, req) => {
        return req.session?.oauthState === state
      },
    })

    const req = {
      query: { code: 'auth-code', state: 'session-state' },
      session: { oauthState: 'session-state' },
    }

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'user1', email: 'test@test.com' }),
      }) as any

    const user = await strategy.validate(req)
    expect(user).not.toBeNull()

    globalThis.fetch = originalFetch
  })

  // ── PKCE ────────────────────────────────────────────────────────────

  it('getAuthorizationUrlWithPkce returns url and codeVerifier', () => {
    const strategy = OAuthStrategy({
      provider: 'google',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      pkce: true,
    })

    const result = strategy.getAuthorizationUrlWithPkce('some-state')
    expect(result.url).toContain('code_challenge=')
    expect(result.url).toContain('code_challenge_method=S256')
    expect(result.url).toContain('state=some-state')
    expect(result.codeVerifier).toBeDefined()
    expect(result.codeVerifier.length).toBeGreaterThan(0)
  })

  it('passes code_verifier in token exchange when provided', async () => {
    const strategy = OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      pkce: true,
      mapProfile: (profile) => ({
        id: String(profile.id),
        roles: ['user'],
      }),
    })

    const originalFetch = globalThis.fetch
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 42 }),
      })
    globalThis.fetch = fetchMock as any

    const req = {
      query: { code: 'auth-code' },
      oauthCodeVerifier: 'my-verifier-123',
    }
    const user = await strategy.validate(req)
    expect(user).toEqual({ id: '42', roles: ['user'] })

    // Verify code_verifier was sent in token exchange
    const tokenExchangeCall = fetchMock.mock.calls[0]
    const body = tokenExchangeCall[1].body
    expect(body).toContain('code_verifier=my-verifier-123')

    globalThis.fetch = originalFetch
  })

  it('skips state validation when stateValidator not configured', async () => {
    const strategy = OAuthStrategy({
      provider: 'github',
      clientId: 'id',
      clientSecret: 'secret',
      callbackUrl: 'http://localhost/callback',
      mapProfile: (profile) => ({
        id: String(profile.id),
        roles: ['user'],
      }),
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1 }),
      }) as any

    // No state in query — should still work when no validator configured
    const req = { query: { code: 'auth-code' } }
    const user = await strategy.validate(req)
    expect(user).not.toBeNull()

    globalThis.fetch = originalFetch
  })
})
