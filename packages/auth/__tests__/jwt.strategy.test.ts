import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import jwt from 'jsonwebtoken'
import { JwtStrategy } from '@forinda/kickjs-auth'

const SECRET = 'test-secret-key-for-tests'

function createToken(payload: any, options?: jwt.SignOptions): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options })
}

describe('JwtStrategy', () => {
  it('validates a valid Bearer token from header', async () => {
    const strategy = JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: 'user-1', email: 'alice@test.com' })

    const req = { headers: { authorization: `Bearer ${token}` } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
    expect(user!.email).toBe('alice@test.com')
  })

  it('returns null for missing Authorization header', async () => {
    const strategy = JwtStrategy({ secret: SECRET })
    const req = { headers: {} }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for malformed header (no Bearer prefix)', async () => {
    const strategy = JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: '1' })
    const req = { headers: { authorization: token } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for expired token', async () => {
    const strategy = JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: '1' }, { expiresIn: '-1s' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for token signed with wrong secret', async () => {
    const strategy = JwtStrategy({ secret: SECRET })
    const token = jwt.sign({ sub: '1' }, 'wrong-secret', { algorithm: 'HS256' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('applies mapPayload to transform the decoded token', async () => {
    const strategy = JwtStrategy({
      secret: SECRET,
      mapPayload: (payload) => ({
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? ['user'],
      }),
    })

    const token = createToken({ sub: 'user-1', email: 'alice@test.com', roles: ['admin'] })
    const req = { headers: { authorization: `Bearer ${token}` } }
    const user = await strategy.validate(req)

    expect(user).toEqual({ id: 'user-1', email: 'alice@test.com', roles: ['admin'] })
  })

  it('reads token from query parameter', async () => {
    const strategy = JwtStrategy({ secret: SECRET, tokenFrom: 'query' })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, query: { token } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
  })

  it('reads token from cookie', async () => {
    const strategy = JwtStrategy({ secret: SECRET, tokenFrom: 'cookie' })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, cookies: { jwt: token } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
  })

  it('supports custom cookie name', async () => {
    const strategy = JwtStrategy({
      secret: SECRET,
      tokenFrom: 'cookie',
      cookieName: 'session_token',
    })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, cookies: { session_token: token } }
    const user = await strategy.validate(req)
    expect(user!.sub).toBe('user-1')
  })

  it('supports custom query param name', async () => {
    const strategy = JwtStrategy({
      secret: SECRET,
      tokenFrom: 'query',
      queryParam: 'access_token',
    })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, query: { access_token: token } }
    const user = await strategy.validate(req)
    expect(user!.sub).toBe('user-1')
  })

  it('has name "jwt"', () => {
    const strategy = JwtStrategy({ secret: SECRET })
    expect(strategy.name).toBe('jwt')
  })

  describe('verifyOptions forwarding', () => {
    it('rejects a token whose issuer does not match verifyOptions.issuer', async () => {
      const strategy = JwtStrategy({
        secret: SECRET,
        verifyOptions: { issuer: 'expected-iss' },
      })
      const token = createToken({ sub: '1', iss: 'wrong-iss' })
      const req = { headers: { authorization: `Bearer ${token}` } }
      expect(await strategy.validate(req)).toBeNull()
    })

    it('accepts a token whose issuer matches verifyOptions.issuer', async () => {
      const strategy = JwtStrategy({
        secret: SECRET,
        verifyOptions: { issuer: 'my-app' },
      })
      const token = createToken({ sub: '1', iss: 'my-app' })
      const req = { headers: { authorization: `Bearer ${token}` } }
      const user = await strategy.validate(req)
      expect(user!.sub).toBe('1')
    })

    it('enforces audience via verifyOptions.audience', async () => {
      const strategy = JwtStrategy({
        secret: SECRET,
        verifyOptions: { audience: 'api.example.com' },
      })
      const good = createToken({ sub: '1', aud: 'api.example.com' })
      const bad = createToken({ sub: '1', aud: 'other.example.com' })

      expect(
        await strategy.validate({ headers: { authorization: `Bearer ${good}` } }),
      ).toBeTruthy()
      expect(
        await strategy.validate({ headers: { authorization: `Bearer ${bad}` } }),
      ).toBeNull()
    })

    it('clockTolerance allows a just-expired token through', async () => {
      const strategy = JwtStrategy({
        secret: SECRET,
        verifyOptions: { clockTolerance: 5 },
      })
      const token = createToken({ sub: '1' }, { expiresIn: '-2s' })
      const req = { headers: { authorization: `Bearer ${token}` } }
      const user = await strategy.validate(req)
      expect(user!.sub).toBe('1')
    })

    it('maxAge caps token age regardless of exp', async () => {
      // Token signed 10 minutes ago with 1h exp — still valid by exp, but
      // maxAge: '1m' should reject it.
      const iat = Math.floor(Date.now() / 1000) - 600
      const token = jwt.sign({ sub: '1', iat }, SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
        noTimestamp: true,
      })
      const strategy = JwtStrategy({
        secret: SECRET,
        verifyOptions: { maxAge: '1m' },
      })
      expect(
        await strategy.validate({ headers: { authorization: `Bearer ${token}` } }),
      ).toBeNull()
    })
  })
})
