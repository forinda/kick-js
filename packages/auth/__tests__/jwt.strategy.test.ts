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
    const strategy = new JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: 'user-1', email: 'alice@test.com' })

    const req = { headers: { authorization: `Bearer ${token}` } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
    expect(user!.email).toBe('alice@test.com')
  })

  it('returns null for missing Authorization header', async () => {
    const strategy = new JwtStrategy({ secret: SECRET })
    const req = { headers: {} }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for malformed header (no Bearer prefix)', async () => {
    const strategy = new JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: '1' })
    const req = { headers: { authorization: token } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for expired token', async () => {
    const strategy = new JwtStrategy({ secret: SECRET })
    const token = createToken({ sub: '1' }, { expiresIn: '-1s' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null for token signed with wrong secret', async () => {
    const strategy = new JwtStrategy({ secret: SECRET })
    const token = jwt.sign({ sub: '1' }, 'wrong-secret', { algorithm: 'HS256' })
    const req = { headers: { authorization: `Bearer ${token}` } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('applies mapPayload to transform the decoded token', async () => {
    const strategy = new JwtStrategy({
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
    const strategy = new JwtStrategy({ secret: SECRET, tokenFrom: 'query' })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, query: { token } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
  })

  it('reads token from cookie', async () => {
    const strategy = new JwtStrategy({ secret: SECRET, tokenFrom: 'cookie' })
    const token = createToken({ sub: 'user-1' })

    const req = { headers: {}, cookies: { jwt: token } }
    const user = await strategy.validate(req)

    expect(user).toBeTruthy()
    expect(user!.sub).toBe('user-1')
  })

  it('supports custom cookie name', async () => {
    const strategy = new JwtStrategy({
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
    const strategy = new JwtStrategy({
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
    const strategy = new JwtStrategy({ secret: SECRET })
    expect(strategy.name).toBe('jwt')
  })
})
