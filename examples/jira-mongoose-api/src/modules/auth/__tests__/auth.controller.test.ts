import 'reflect-metadata'
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import {
  Container,
  Controller,
  Post,
  Get,
  Middleware,
  HttpException,
} from '@forinda/kickjs'
import type { MiddlewareHandler } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

// ── Test JWT secret ──────────────────────────────────────────────────
const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!'

// Stub env vars so they don't leak to other tests
beforeAll(() => {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET)
  vi.stubEnv('JWT_REFRESH_SECRET', TEST_JWT_SECRET)
  vi.stubEnv('JWT_ACCESS_EXPIRES_IN', '15m')
  vi.stubEnv('JWT_REFRESH_EXPIRES_IN', '7d')
  vi.stubEnv('DATABASE_URL', 'mongodb://test:test@localhost/test')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

// ── Test auth middleware (same logic as the real one) ─────────────────

const testAuthMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const header = ctx.req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Missing or invalid authorization header')
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, TEST_JWT_SECRET) as jwt.JwtPayload
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

// ── Test controllers ─────────────────────────────────────────────────

@Controller()
class TestProtectedController {
  @Get('/')
  @Middleware(testAuthMiddleware)
  async getProfile(ctx: RequestContext) {
    const user = ctx.get('user')
    ctx.json({ data: user })
  }
}

@Controller()
class TestPublicController {
  @Get('/')
  async health(ctx: RequestContext) {
    ctx.json({ status: 'ok' })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  beforeEach(() => Container.reset())

  function buildProtectedModule() {
    return createTestModule({
      register: (c) => c.register(TestProtectedController, TestProtectedController),
      routes: () => ({
        path: '/protected',
        router: buildRoutes(TestProtectedController),
        controller: TestProtectedController,
      }),
    })
  }

  it('rejects requests without Authorization header', async () => {
    const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })

    const res = await request(expressApp).get('/api/v1/protected').expect(401)
    expect(res.body.message).toMatch(/Missing or invalid/)
  })

  it('rejects requests with invalid token', async () => {
    const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })

    const res = await request(expressApp)
      .get('/api/v1/protected')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401)

    expect(res.body.message).toMatch(/Invalid or expired/)
  })

  it('accepts requests with valid JWT and exposes user', async () => {
    const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })

    const token = jwt.sign(
      { sub: 'u1', email: 'alice@test.com', globalRole: 'user' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await request(expressApp)
      .get('/api/v1/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.id).toBe('u1')
    expect(res.body.data.email).toBe('alice@test.com')
  })

  it('rejects expired tokens', async () => {
    const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })

    const token = jwt.sign(
      { sub: 'u1', email: 'alice@test.com', globalRole: 'user' },
      TEST_JWT_SECRET,
      { expiresIn: '-1s' }, // already expired
    )

    await request(expressApp)
      .get('/api/v1/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
  })

  it('public routes work without auth', async () => {
    const PublicModule = createTestModule({
      register: (c) => c.register(TestPublicController, TestPublicController),
      routes: () => ({
        path: '/health',
        router: buildRoutes(TestPublicController),
        controller: TestPublicController,
      }),
    })

    const { expressApp } = await createTestApp({ modules: [PublicModule] })

    const res = await request(expressApp).get('/api/v1/health').expect(200)
    expect(res.body.status).toBe('ok')
  })
})
