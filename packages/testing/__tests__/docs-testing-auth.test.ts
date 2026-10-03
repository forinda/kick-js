/**
 * The auth examples in docs/guide/testing/auth.md, run against the BYO auth
 * recipe (docs/guide/byo-recipes.md) as written there.
 */
import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import express from 'express'
import {
  Controller,
  Get,
  Post,
  createToken,
  csrf,
  defineAdapter,
  defineHttpContextDecorator,
  defineRouteFlag,
  session,
  withEnv,
  getEnv,
  type RequestContext,
} from '@forinda/kickjs'
import { createTestApp, createTestModule, runContributor } from '../src/index'

// ── The recipe ─────────────────────────────────────────────────────────
interface AuthUser {
  id: string
  roles: readonly string[]
}
interface AuthStrategy {
  name: string
  validate(ctx: RequestContext): AuthUser | null | Promise<AuthUser | null>
}
const AUTH_STRATEGIES = createToken<readonly AuthStrategy[]>('docs/auth/strategies')
const jwtStrategy = (secret: string): AuthStrategy => ({
  name: 'jwt',
  validate: (ctx) => {
    const auth = ctx.req.headers.authorization as string | undefined
    if (!auth?.startsWith('Bearer ')) return null
    try {
      const p = jwt.verify(auth.slice(7), secret) as jwt.JwtPayload
      return { id: p.sub as string, roles: (p.roles as string[]) ?? ['user'] }
    } catch {
      return null
    }
  },
})
const unauthorized = () => Object.assign(new Error('Unauthorized'), { status: 401 })
const LoadAuthUser = defineHttpContextDecorator.withParams<{ on401: 'allow' | 'reject' }>()({
  key: 'user' as never,
  deps: { strategies: AUTH_STRATEGIES },
  skipWhen: 'auth.public' as never,
  paramDefaults: { on401: 'reject' },
  resolve: async (ctx, { strategies }, params) => {
    for (const s of strategies) {
      const user = await s.validate(ctx as never)
      if (user) return user as never
    }
    if (params.on401 === 'allow') return null as never
    throw unauthorized()
  },
})
const RequireRole = defineHttpContextDecorator.withParams<{ roles: readonly string[] }>()({
  key: 'roleCheck' as never,
  dependsOn: ['user' as never],
  paramDefaults: { roles: [] },
  resolve: (ctx, _deps, params) => {
    const user = ctx.get('user' as never) as AuthUser | null
    if (!user) throw unauthorized()
    if (!params.roles.some((r) => user.roles.includes(r))) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    return true as never
  },
})
const Public = defineRouteFlag('auth.public')
// As in byo-recipes.md step 6.
const AuthAdapter = defineAdapter<{ strategies: readonly AuthStrategy[] }>({
  name: 'AuthAdapter',
  build: (opts) => ({
    beforeStart: ({ container }) => {
      container.registerInstance(AUTH_STRATEGIES, opts.strategies)
    },
    contributors: () => [LoadAuthUser.with({ on401: 'reject' }).registration],
  }),
})

@Controller()
class ProjectController {
  @Public
  @Get('/health')
  health() {
    return { ok: true }
  }

  @Get('/me')
  me(ctx: RequestContext) {
    return { user: ctx.get('user' as never) }
  }

  @RequireRole({ roles: ['admin'] })
  @Post('/archive')
  archive() {
    return { archived: true }
  }
}

const ProjectModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/projects', controller: ProjectController }),
})

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

describe('testing authentication', () => {
  // The app reads JWT_SECRET from the env, as the recipe's bootstrap does.
  const boot = () =>
    createTestApp({
      modules: [ProjectModule],
      adapters: [AuthAdapter({ strategies: [jwtStrategy(getEnv('JWT_SECRET' as never))] })],
    })
  const signTestToken = (
    claims: { sub: string; roles?: string[] },
    expiresIn: jwt.SignOptions['expiresIn'] = '1h',
  ) => jwt.sign(claims, getEnv('JWT_SECRET' as never), { expiresIn })

  it('signs a token the app accepts; rejects none, an expired one and a missing role', async () => {
    await withEnv({ JWT_SECRET: SECRET }, async () => {
      const { client } = await boot()
      const api = client({ basePath: '/api/v1/projects' })
      await api.get('/health').expect(200)
      await api.get('/me').expect(401)
      await api
        .as(signTestToken({ sub: 'u1' }, '-1s'))
        .get('/me')
        .expect(401)
      const me = await api
        .as(signTestToken({ sub: 'u1', roles: ['member'] }))
        .get('/me')
        .expect(200)
      expect(me.body.user).toEqual({ id: 'u1', roles: ['member'] })
      await api
        .as(signTestToken({ sub: 'u1', roles: ['member'] }))
        .post('/archive')
        .expect(403)
      await api
        .as(signTestToken({ sub: 'u2', roles: ['admin'] }))
        .post('/archive')
        .expect(200)
    })
  })

  it('swaps the strategies for one that trusts a test header', async () => {
    const testUser: AuthStrategy = {
      name: 'test',
      validate: (ctx) => {
        const id = ctx.req.headers['x-test-user'] as string | undefined
        return id ? { id, roles: [String(ctx.req.headers['x-test-role'] ?? 'user')] } : null
      },
    }
    const { client } = await createTestApp({
      modules: [ProjectModule],
      adapters: [AuthAdapter({ strategies: [] })],
      overrides: [[AUTH_STRATEGIES, [testUser]]],
    })
    const asAdmin = client({ basePath: '/api/v1/projects' }).withHeaders({
      'x-test-user': 'u-admin',
      'x-test-role': 'admin',
    })
    await asAdmin.post('/archive').expect(200)
  })

  it('unit-tests the guard with runContributor', async () => {
    await expect(
      runContributor(RequireRole.with({ roles: ['admin'] }) as never, {
        initial: { user: { id: 'u1', roles: ['member'] } },
      }),
    ).rejects.toThrow('Forbidden')
  })
})

@Controller()
class SessionController {
  @Post('/login')
  async login(ctx: RequestContext) {
    const { email } = ctx.body as { email: string }
    await ctx.session.regenerate()
    ctx.session.data.userId = email
    return { ok: true }
  }

  @Get('/me')
  me(ctx: RequestContext) {
    return { userId: ctx.session.data.userId ?? null }
  }

  @Get('/form')
  form() {
    return { ok: true }
  }

  @Post('/notes')
  note() {
    return { saved: true }
  }
}

const SessionModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/session', controller: SessionController }),
})

describe('sessions and CSRF', () => {
  it('logs in once; the cookie client carries the session', async () => {
    const { client } = await createTestApp({
      modules: [SessionModule],
      // Given, `middlewares` replaces the default list — body parsing included.
      middlewares: [express.json(), session({ secret: 'test-session-secret' })] as never,
    })
    const browser = client({ cookies: true, basePath: '/api/v1/session' })
    await browser.post('/login').send({ email: 'ada@x.io' }).expect(200)
    expect((await browser.get('/me')).body).toEqual({ userId: 'ada@x.io' })
    expect((await client({ basePath: '/api/v1/session' }).get('/me')).body).toEqual({
      userId: null,
    })
  })

  it('reads the CSRF cookie and echoes it in the header', async () => {
    const { client } = await createTestApp({
      modules: [SessionModule],
      middlewares: [csrf()] as never,
    })
    const browser = client({ cookies: true, basePath: '/api/v1/session' })
    const first = await browser.get('/form')
    const cookie = ([] as string[])
      .concat(first.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('_csrf='))
    const token = decodeURIComponent(cookie!.split(';')[0].slice('_csrf='.length))

    await browser.post('/notes').expect(403)
    await browser.withHeaders({ 'x-csrf-token': token }).post('/notes').expect(200)
  })
})
