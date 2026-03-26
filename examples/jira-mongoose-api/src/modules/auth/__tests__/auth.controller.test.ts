import 'reflect-metadata'
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import {
  Container,
  Controller,
  Post,
  Get,
  Middleware,
  HttpException,
} from '@forinda/kickjs-core'
import type { MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

// ── Test JWT secret ──────────────────────────────────────────────────
const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!'

// Set env vars before any import that reads them
beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  process.env.JWT_REFRESH_SECRET = TEST_JWT_SECRET
  process.env.JWT_ACCESS_EXPIRES_IN = '15m'
  process.env.JWT_REFRESH_EXPIRES_IN = '7d'
  process.env.DATABASE_URL = 'mongodb://test:test@localhost/test'
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
