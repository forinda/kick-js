import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Container, Controller, Get, Middleware, HttpException } from '@forinda/kickjs-core'
import type { MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

const JWT_SECRET = 'a-very-long-test-secret-that-is-at-least-32-chars'

/**
 * Mirrors the production authBridgeMiddleware but reads JWT_SECRET from
 * process.env so we can test without importing the Zod-validated env module.
 */
const testAuthMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const header = ctx.req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Missing or invalid authorization header')
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload
    ctx.set('user', {
      id: payload.sub!,
      email: payload.email as string,
      globalRole: payload.globalRole as string,
    })
  } catch {
    throw HttpException.unauthorized('Invalid or expired token')
  }

  next()
}

function signToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

// ── Test controller that uses auth middleware ─────────────────────────

@Controller()
@Middleware(testAuthMiddleware)
class ProtectedController {
  @Get('/me')
  async me(ctx: RequestContext) {
    const user = ctx.get('user') as { id: string; email: string; globalRole: string }
    if (!user) throw HttpException.unauthorized('Authentication required')
    ctx.json({ data: user })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('authBridgeMiddleware', () => {
  beforeAll(() => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.register(ProtectedController, ProtectedController)
      },
      routes: () => ({
        path: '/protected',
        router: buildRoutes(ProtectedController),
        controller: ProtectedController,
      }),
    })
  }

  it('returns 401 when no Authorization header is provided', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/protected/me').expect(401)
  })

  it('returns 401 when Authorization header has wrong format', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', 'Basic abc')
      .expect(401)
  })

  it('returns 401 for an invalid/expired token', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401)
  })

  it('returns 200 and user data for a valid token', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const token = signToken({ sub: 'u1', email: 'alice@test.com', globalRole: 'user' })

    const res = await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.id).toBe('u1')
    expect(res.body.data.email).toBe('alice@test.com')
    expect(res.body.data.globalRole).toBe('user')
  })

  it('extracts correct user from token payload', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const token = signToken({ sub: 'u99', email: 'admin@test.com', globalRole: 'superadmin' })

    const res = await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.id).toBe('u99')
    expect(res.body.data.globalRole).toBe('superadmin')
  })
})
