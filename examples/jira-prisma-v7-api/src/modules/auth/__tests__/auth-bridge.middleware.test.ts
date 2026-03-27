import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Container, Controller, Get, Middleware, HttpException } from '@forinda/kickjs-core'
import type { MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

const TEST_JWT_SECRET = 'a-very-long-secret-that-is-at-least-32-chars!!'

// ── Test auth middleware (same logic as the real one, but uses test secret) ──

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

// ── Test controller that requires auth ───────────────────────────────

@Controller()
@Middleware(testAuthMiddleware)
class TestProtectedController {
  @Get('/me')
  async me(ctx: RequestContext) {
    const user = ctx.get('user')
    ctx.json({ data: user })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('authBridgeMiddleware', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.register(TestProtectedController, TestProtectedController)
      },
      routes: () => ({
        path: '/protected',
        router: buildRoutes(TestProtectedController),
        controller: TestProtectedController,
      }),
    })
  }

  it('rejects requests without Authorization header', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/protected/me').expect(401)
    expect(res.body.message).toMatch(/Missing or invalid/)
  })

  it('rejects requests with invalid token', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', 'Bearer bad.token.here')
      .expect(401)
    expect(res.body.message).toMatch(/Invalid or expired/)
  })

  it('passes authentication and sets user on context with a valid token', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const token = jwt.sign(
      { sub: 'u1', email: 'alice@test.com', globalRole: 'user' },
      TEST_JWT_SECRET,
      { expiresIn: '1h' },
    )

    const res = await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body.data.id).toBe('u1')
    expect(res.body.data.email).toBe('alice@test.com')
  })

  it('rejects expired tokens', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const token = jwt.sign(
      { sub: 'u1', email: 'alice@test.com', globalRole: 'user' },
      TEST_JWT_SECRET,
      { expiresIn: '-1s' },
    )

    await request(expressApp)
      .get('/api/v1/protected/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
  })
})
