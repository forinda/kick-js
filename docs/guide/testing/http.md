---
description: Integration-testing KickJS HTTP endpoints — createTestApp, the request client, useTestApp, DI overrides, testing the runtime you deploy, errors, uploads and the typed client.
---

# HTTP Integration Tests

An integration test boots your real modules — controllers, services, middleware, contributors — and sends requests through the same pipeline production runs, without opening a port. `createTestApp` from `@forinda/kickjs-testing` builds the app; its `client()` sends the requests.

## Your first endpoint test

```ts
import { describe, expect, it } from 'vitest'
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule } from '@/modules/users/user.module'

describe('users', () => {
  it('lists users', async () => {
    const { client } = await createTestApp({ modules: [UserModule()] })

    const res = await client().get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(1)
  })
})
```

`createTestApp` resets the DI container, registers the modules, runs the adapters' setup hooks and mounts the routes, then returns:

| Field       | What it is                                                                        |
| ----------- | --------------------------------------------------------------------------------- |
| `client`    | `client(options?)` — a request client (below)                                     |
| `app`       | the `Application`; `app.handle` is its Node request listener                      |
| `container` | the DI container the app resolved from — for resolving or spying on real services |

It's async: always `await` it.

## The request client

`client()` sends requests through `app.handle`, so they reach whichever runtime the app runs on. It's supertest underneath (add `supertest` as a dev dependency), so `.send()`, `.query()`, `.attach()`, `.expect()` and the rest work as usual. Set what every request needs once:

```ts
const api = client({ headers: { host: 'localhost' }, basePath: '/api/v1' })

await api.get('/health').expect(200)
await api.withHeaders({ 'x-tenant': 'acme' }).get('/projects')
```

| Option     | Does                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| `headers`  | sent with every request                                                    |
| `bearer`   | sent as `Authorization: Bearer <token>`                                    |
| `basePath` | prefixed to every path                                                     |
| `cookies`  | keep cookies between requests, like a browser — for session and CSRF flows |

`.as(token)` sends `Authorization: Bearer <token>`, and `.withHeaders({...})` adds headers. Both return a new client and leave the one they came from unchanged, so one base client serves every user in a test.

The token is one your app would accept. Auth is your own code in KickJS (there's no built-in auth package since v8), so the test signs a token the same way your login does, with the secret your auth adapter verifies against. In tests that secret comes from `.env.test`:

```ts
// tests/helpers/auth.ts
import jwt from 'jsonwebtoken'
import { getEnv } from '@forinda/kickjs'

/** A token the app accepts: signed with the secret its auth adapter verifies with. */
export function signTestToken(claims: { sub: string; email?: string; roles?: string[] }) {
  return jwt.sign(claims, getEnv('JWT_SECRET'), { expiresIn: '1h' })
}
```

```ts
import { signTestToken } from './helpers/auth'

const adminToken = signTestToken({ sub: 'u-admin', roles: ['admin'] })
const memberToken = signTestToken({ sub: 'u-member', roles: ['member'] })

await api.as(adminToken).delete('/projects/p1').expect(204)
await api.as(memberToken).delete('/projects/p1').expect(403)
```

Logging in through the API instead, testing with a session cookie, and switching auth off are covered in [Testing Authentication](./auth.md).

::: tip Driving supertest yourself
`client()` is a convenience. `request(app.handle.bind(app))` works on every runtime too, if you'd rather use supertest directly. Avoid `expressApp`: it's deprecated, and it throws under Fastify and h3.
:::

## Replace a dependency: `overrides`

Test the real controller with a fake where it matters — a repository backed by an array, a payment gateway that records calls — by overriding its binding:

```ts
const USER_REPOSITORY = createToken<UserRepository>('app/Users/repository')

const { client } = await createTestApp({
  modules: [UserModule()],
  overrides: [[USER_REPOSITORY, new InMemoryUserRepository([{ id: 'u9', email: 'x@x.io' }])]],
})
```

Overrides apply after the modules register, so they win over what a module bound. Three shapes are accepted:

- **Entries**, `[[token, value], …]`, for `createToken()` tokens and classes.
- **A `Map`**, the same thing.
- **An object literal**, `{ [KEY]: value }`, for string and symbol keys only.

::: danger `[TOKEN.name]` compiles and does nothing
A `createToken()` token is an object, and the container matches it by reference. `{ [TOKEN.name]: fake }` type-checks, because `name` is a string, but it registers under a different key, and the real binding stays. Use the entries form.
:::

Prefer an override to a test-only copy of a controller: the copy drifts from the real one, and the test stops covering the code you ship.

### Spy on a real service

To check what a collaborator was called with while keeping its real behaviour, resolve it from the test app's container and spy on it:

```ts
const { client, container } = await createTestApp({ modules: [UserModule()] })
const send = vi.spyOn(container.resolve(Notifier), 'send')

await client().delete('/api/v1/users/u1').expect(204)
expect(send).toHaveBeenCalledWith('ops@x.io', 'deleted u1')
```

Services are singletons per container, so the instance you spy on is the one the controller holds.

## One app per file: `useTestApp`

`useTestApp`, from `@forinda/kickjs-testing/vitest`, registers the `beforeAll` / `afterAll` that build and shut down the app:

```ts
import { useTestApp } from '@forinda/kickjs-testing/vitest'

const t = useTestApp(() => ({ modules: [UserModule()] }), {
  client: { basePath: '/api/v1' },
})

it('lists users', async () => {
  await t.client().get('/users').expect(200)
})

it('removes a user', async () => {
  await t.client().delete('/users/u1').expect(204)
})
```

`t.app`, `t.container` and `t.client()` work inside tests and hooks. The app is shared by the file's tests, so a test that changes state should undo it, or the file should reset it with [`onTestReset`](./large-suites.md#reset-state-not-the-app-ontestreset). For large suites, `shared: true` keeps one app per worker instead of one per file — see [Large Suites](./large-suites.md).

## Use the app's real options

Build the test app from the same options `bootstrap()` takes, so middleware, adapters and contributors match production. Keep them in one module and spread them in:

```ts
// src/app.ts
import type { ApplicationOptions } from '@forinda/kickjs'

export const appOptions = {
  modules: [UserModule(), ProjectModule()],
  adapters: [authAdapter],
  contributors: [LoadTenant.registration],
} satisfies ApplicationOptions

// src/index.ts
await bootstrap(appOptions)

// tests
const t = useTestApp(() => ({ ...appOptions, overrides: [[MAILER, fakeMailer]] }))
```

Options that only matter to a listening server (the port, cluster mode) are ignored by the test app.

## Test the runtime you deploy

Routing, body parsing, status handling and error mapping live in the runtime, so a suite running Express proves little about an app deployed on Fastify. Pass the runtime your `bootstrap()` uses:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { client } = await createTestApp({ modules: [UserModule()], runtime: fastifyRuntime() })
```

To run one suite on every runtime you support:

```ts
import { expressRuntime } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'

describe.each([
  { name: 'express', runtime: () => expressRuntime() },
  { name: 'fastify', runtime: () => fastifyRuntime() },
  { name: 'h3', runtime: () => h3Runtime() },
])('users on $name', ({ runtime }) => {
  it('creates a user', async () => {
    const { client } = await createTestApp({ modules: [UserModule()], runtime: runtime() })
    await client().post('/api/v1/users').send({ email: 'a@x.io' }).expect(201)
  })
})
```

Leave `middlewares` out unless you're testing them: each runtime has its own body parsing, and the default picks the right one. Passing `express.json()` to Fastify makes a JSON request hang.

## Errors

A thrown `HttpException` (or a validation failure) is answered as [Problem Details](../error-handling.md) with `Content-Type: application/problem+json`:

```ts
const res = await client().get('/api/v1/users/nope').expect(404)
expect(res.headers['content-type']).toMatch(/application\/problem\+json/)
expect(res.body).toMatchObject({ status: 404, detail: 'User not found' })
```

Assert on `status` and `detail`, or your own `type`, rather than on the whole body: Problem Details may grow fields.

## File uploads

```ts
@Controller()
class AvatarController {
  @Post('/')
  @FileUpload({ mode: 'single', fieldName: 'file', maxSize: 1024 })
  upload(ctx: RequestContext) {
    return { name: ctx.file?.originalname, size: ctx.file?.size }
  }
}

it('accepts a file, and refuses one over the limit', async () => {
  const { client } = await createTestApp({ modules: [AvatarModule()] })
  const api = client({ basePath: '/api/v1' })

  const ok = await api.post('/avatars').attach('file', Buffer.from('hello'), 'a.txt').expect(200)
  expect(ok.body).toEqual({ name: 'a.txt', size: 5 })

  await api.post('/avatars').attach('file', Buffer.alloc(2048), 'big.bin').expect(413)
})
```

`@FileUpload` works on every runtime; the Express-only `@Middleware(upload.single(...))` form tests the same way. A file of the wrong type answers `415`. See [File Uploads](../file-uploads.md).

## Typed requests: `createTestClient`

For an app built with [`createWebApp`](../edge-deployment.md), [`@forinda/kickjs-client`](../typed-client.md#network-free-testing)'s `createTestClient` calls routes in-process with the request and response types inferred from your controllers:

```ts
import { createTestClient } from '@forinda/kickjs-client'

const api = createTestClient<KickRoutes.Api>(createWebApp({ h3, modules }))
const task = await api.post('/tasks', { body: { title: 'x' } }) // task: Task
```

A wrong path, param or body is a compile error rather than a 404 at run time.

## Isolated containers

`createTestApp` resets the global container by default, so tests in one file run one after another without seeing each other's bindings. To run tests concurrently (`it.concurrent`, Vitest's threads pool without isolation), give each app its own container:

```ts
const { client } = await createTestApp({ modules: [UserModule()], isolated: true })
```

## Options

Everything `createTestApp` accepts:

| Option                                                                                                                                             | Default           | Notes                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `modules`                                                                                                                                          | —                 | required; class modules or `defineModule()` results        |
| `adapters`                                                                                                                                         | none              | their `beforeMount` / `beforeStart` hooks run during setup |
| `overrides`                                                                                                                                        | none              | see [above](#replace-a-dependency-overrides)               |
| `isolated`                                                                                                                                         | `false`           | own container instead of resetting the global one          |
| `runtime`                                                                                                                                          | Express           | the engine under test                                      |
| `middlewares`                                                                                                                                      | the runtime's own | given, it replaces the default list, body parsing included |
| `contributors`, `plugins`, `apiPrefix`, `defaultVersion`, `onError`, `onNotFound`, `trustProxy`, `jsonLimit`, `security`, `contextStore`, `health` | as in `bootstrap` | passed through unchanged                                   |
