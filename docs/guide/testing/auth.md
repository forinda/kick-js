---
description: Testing authenticated KickJS endpoints — signing tokens the app accepts, logging in through the API, swapping auth strategies, roles, @Public, session cookies and CSRF.
---

# Testing Authentication

KickJS ships no auth layer: you build it from a context decorator, a strategy list and an adapter (the [Authentication](../authentication.md) guide and the [BYO recipe](../byo-recipes.md)). This page tests that setup. Pick how a test gets its user:

| You want to test                                      | Use                                                   |
| ----------------------------------------------------- | ----------------------------------------------------- |
| endpoints as a given user, with the real JWT checking | [a signed token](#a-token-the-app-accepts)            |
| the login endpoint itself, or a full sign-in journey  | [logging in through the API](#log-in-through-the-api) |
| business rules, with auth beside the point            | [a test strategy](#replace-the-strategies)            |
| a session-based app                                   | [a cookie client](#sessions)                          |

## A token the app accepts

Sign a token the way your login endpoint does, with the secret your auth adapter verifies against. That secret comes from config, so in tests it comes from `.env.test`:

```ini
# .env.test
JWT_SECRET=test-secret-that-is-at-least-32-chars!!
```

```ts
// tests/helpers/auth.ts
import jwt from 'jsonwebtoken'
import { getEnv } from '@forinda/kickjs'

/** A token the app accepts: signed with the secret its auth adapter verifies with. */
export function signTestToken(
  claims: { sub: string; email?: string; roles?: string[] },
  expiresIn: jwt.SignOptions['expiresIn'] = '1h',
) {
  return jwt.sign(claims, getEnv('JWT_SECRET'), { expiresIn })
}
```

The claims are the ones your strategy's `mapPayload` reads: `sub`, `email` and `roles` in the recipe. Then send the token with the client's `.as()`:

```ts
import { signTestToken } from './helpers/auth'

const t = useTestApp(() => appOptions, { client: { basePath: '/api/v1/projects' } })

it('needs a user, and the admin role to archive', async () => {
  const api = t.client()
  await api.get('/me').expect(401)
  await api
    .as(signTestToken({ sub: 'u1' }, '-1s'))
    .get('/me')
    .expect(401) // expired

  const member = signTestToken({ sub: 'u1', roles: ['member'] })
  const me = await api.as(member).get('/me').expect(200)
  expect(me.body.user).toEqual({ id: 'u1', roles: ['member'] })

  await api.as(member).post('/archive').expect(403)
  await api
    .as(signTestToken({ sub: 'u2', roles: ['admin'] }))
    .post('/archive')
    .expect(200)
})

it('leaves @Public routes open', async () => {
  await t.client().get('/health').expect(200)
})
```

The test runs the real strategy, the real `LoadAuthUser` and the real role check; only the token is made in the test.

::: tip Tokens from your own code
If your app has a `TokenService` (or similar) that issues tokens, resolve it from the test app and use it: `t.container.resolve(TokenService).issue(user)`. The test then also catches a change in how tokens are built.
:::

## Log in through the API

To test the login endpoint, or a journey that starts at sign-in, log in the way a client does and keep the token it returns:

```ts
async function logIn(api: TestClient, email: string, password: string) {
  const res = await api.post('/auth/login').send({ email, password }).expect(200)
  return res.body.accessToken as string
}

it('signs in and reads the profile', async () => {
  const api = t.client({ basePath: '/api/v1' })
  const token = await logIn(api, 'ada@x.io', 'correct horse')
  await api.as(token).get('/me').expect(200)
})
```

The user has to exist first: insert it in a `beforeAll` (with the password hashed the way your app hashes it), or create it through your sign-up endpoint.

## Replace the strategies

When a test is about what an endpoint does, not about how users are recognised, replace the strategy list with one that trusts a test header. The recipe's adapter registers the strategies under `AUTH_STRATEGIES`, so override that token:

```ts
import { AUTH_STRATEGIES, type AuthStrategy } from '../src/auth'

const testUser: AuthStrategy = {
  name: 'test',
  validate: (ctx) => {
    const id = ctx.req.headers['x-test-user'] as string | undefined
    return id ? { id, roles: [String(ctx.req.headers['x-test-role'] ?? 'user')] } : null
  },
}

const t = useTestApp(() => ({ ...appOptions, overrides: [[AUTH_STRATEGIES, [testUser]]] }))

it('archives as an admin', async () => {
  const asAdmin = t.client().withHeaders({ 'x-test-user': 'u-admin', 'x-test-role': 'admin' })
  await asAdmin.post('/api/v1/projects/archive').expect(200)
})
```

Overrides apply after the adapters' setup, so they replace what `AuthAdapter` registered. Everything else (`@Public`, `RequireRole`, the 401 for a request with no user) still runs for real. Keep the test strategy in test code only.

## Unit-test the guards

The strategies, `LoadAuthUser` and `RequireRole` are plain functions and context decorators, so test their logic without HTTP. `runContributor` runs one contributor against a fake context:

```ts
import { runContributor } from '@forinda/kickjs-testing'

it('refuses a member', async () => {
  await expect(
    runContributor(RequireRole.with({ roles: ['admin'] }), {
      initial: { user: { id: 'u1', roles: ['member'] } }, // what LoadAuthUser would have set
    }),
  ).rejects.toThrow('Forbidden')
})

it('reads the bearer token', async () => {
  const strategy = jwtStrategy({
    secret: 's'.repeat(32),
    mapPayload: (p) => ({ id: p.sub!, roles: [] }),
  })
  const ctx = {
    req: { headers: { authorization: `Bearer ${jwt.sign({ sub: 'u1' }, 's'.repeat(32))}` } },
  }
  expect(await strategy.validate(ctx as never)).toEqual({ id: 'u1', roles: [] })
})
```

More in [Testing Contributors, Middleware and Plugins](./contributors.md).

## Sessions

A session lives in a cookie, so use a client that keeps cookies. Sign in once, and the next requests carry the session:

```ts
const { client } = await createTestApp({
  modules: [AccountModule()],
  // Given, `middlewares` replaces the default list, so body parsing goes in too.
  middlewares: [express.json(), session({ secret: 'test-session-secret' })],
})

it('remembers who signed in', async () => {
  const browser = client({ cookies: true, basePath: '/api/v1/session' })
  await browser.post('/login').send({ email: 'ada@x.io' }).expect(200)
  expect((await browser.get('/me')).body).toEqual({ userId: 'ada@x.io' })

  // A client without cookies is a stranger.
  expect((await client({ basePath: '/api/v1/session' }).get('/me')).body).toEqual({ userId: null })
})
```

Clients scoped from a cookie client (`.as()`, `.withHeaders()`) share its cookie jar. For several users at once, make one cookie client each. The default session store is in memory, so sessions don't outlive the test app.

## CSRF

`csrf()` is a double-submit check: the first response sets a `_csrf` cookie, and a POST, PUT, PATCH or DELETE must echo its value in the `x-csrf-token` header. Do what a browser page does:

```ts
it('accepts a form post that echoes the token', async () => {
  const browser = client({ cookies: true, basePath: '/api/v1' })

  const page = await browser.get('/form')
  const cookie = [page.headers['set-cookie']].flat().find((c) => c?.startsWith('_csrf='))!
  const token = decodeURIComponent(cookie.split(';')[0].slice('_csrf='.length))

  await browser.post('/notes').expect(403) // no token
  await browser.withHeaders({ 'x-csrf-token': token }).post('/notes').expect(200)
})
```

To leave CSRF out of most tests, build their app without `csrf()` in `middlewares`, and keep a few tests like this one that include it.
