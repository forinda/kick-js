# Testing

The `@forinda/kickjs-testing` package provides utilities for integration testing KickJS applications. Works with Vitest and supertest.

::: tip Scaffold one
`kick g test <name>` writes a Vitest file with the `Container.reset()` setup already in place — the step most easily forgotten, and the one that makes tests interfere when it is missing.

<PmCommand exec="kick g test users" />

`kick g module` writes controller and repository tests alongside the module. Full flag list: [Generators](./generators.md#kick-g-test).
:::

## Typed API tests with the client

For request-level integration tests, [`@forinda/kickjs-client`](./typed-client.md)'s
`createTestClient` drives a [`createWebApp`](./edge-deployment.md) app in-process —
typed end to end, no ports, no supertest:

```ts
import { createTestClient } from '@forinda/kickjs-client'
import { createWebApp } from '@forinda/kickjs/web'

const app = createWebApp({ h3, modules })
const api = createTestClient<KickRoutes.Api>(app)

const created = await api.post('/tasks', { body: { title: 'x' } }) // created: Task
```

## Setup

<PmCommand add="@forinda/kickjs-testing supertest @types/supertest vitest" dev />

## createTestApp

Creates an Application instance for testing — resets DI, runs `setup()`, and returns the app to drive with supertest:

```ts
import request from 'supertest'
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule } from '../src/modules/users'

const { app, container } = await createTestApp({
  modules: [UserModule],
})

const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

`app.handle` is the Application's own Node request listener, so this works
whichever runtime the app is configured with. See
[Testing the engine you deploy](#testing-the-engine-you-deploy).

::: tip
`createTestApp` is **async** — always `await` it.
:::

### Options

```ts
interface CreateTestAppOptions {
  modules: AppModuleEntry[]
  adapters?: AppAdapter[]
  // string / symbol keys, or entries / a Map for `createToken()` keys
  overrides?:
    | Record<symbol | string, any>
    | ReadonlyArray<readonly [token: unknown, value: unknown]>
    | ReadonlyMap<unknown, unknown>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
  middleware?: express.RequestHandler[] // replaces default (express.json())
  isolated?: boolean // use Container.create() instead of reset()
  runtime?: HttpRuntime // engine under test — defaults to Express
}
```

### Overriding a token binding

An object literal covers string and symbol keys. It cannot cover
`createToken()` — a token is a frozen _object_ identified by reference, and
TypeScript rejects an object as a computed key (`TS2464`). Pass entries instead:

```ts
const DATABASE = createToken<Database>('app/Db/connection')

const { app } = await createTestApp({
  modules: [UserModule()],
  overrides: [[DATABASE, fakeDb()]],
})
```

A `Map` works the same way.

::: danger `[TOKEN.name]` compiles and does nothing
`TOKEN.name` is a string, so it type-checks — but the container keys tokens by
_reference_, so the override is accepted and never applied, leaving the real
binding in place. Use the entries form.
:::

### Testing the engine you deploy

The HTTP engine is pluggable, and routing, body parsing and error mapping all
live in the runtime seam. A suite that runs Express while production runs
Fastify is not testing those at all.

Pass the same `runtime` your `bootstrap()` uses, and drive the app rather than
`expressApp` — `app.handle` is the Application's own Node listener and follows
whichever engine is configured:

```ts
import request from 'supertest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { app } = await createTestApp({
  modules: [UserModule],
  runtime: fastifyRuntime(),
})

const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

`expressApp` still works under the Express runtime, but throws under any other
engine rather than handing back that engine's instance mistyped as
`express.Express`.

To run one suite across every engine you support:

```ts
describe.each([
  { name: 'express', runtime: () => expressRuntime(), middlewares: [express.json()] },
  { name: 'fastify', runtime: () => fastifyRuntime(), middlewares: [] },
])('users on $name', ({ runtime, middleware }) => {
  // Fastify parses JSON natively; Express needs the middleware.
})
```

## Testing a Module

The recommended pattern: create an in-memory repository, wire a test controller without auth, and test via supertest.

### 1. In-Memory Repository

Implement the repository interface with a plain array:

```ts
import type { IUserRepository, User, NewUser } from '../domain/repositories/user.repository'

class InMemoryUserRepository implements IUserRepository {
  private users: User[] = [{ id: 'u1', email: 'alice@test.com', firstName: 'Alice' /* ... */ }]

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null
  }

  async findAll() {
    return this.users
  }

  async create(dto: NewUser) {
    const user: User = { id: `u${this.users.length + 1}`, ...dto }
    this.users.push(user)
    return user
  }

  async delete(id: string) {
    this.users = this.users.filter((u) => u.id !== id)
  }
}
```

### 2. Test Controller (no auth)

Create a lightweight controller that skips auth middleware:

```ts
import { Controller, Get, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { USER_REPOSITORY, type IUserRepository } from '../domain/repositories/user.repository'

@Controller()
class TestUserController {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: IUserRepository) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const users = await this.repo.findAll()
    ctx.json({ data: users, total: users.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const user = await this.repo.findById(ctx.params.id)
    if (!user) return ctx.notFound('User not found')
    ctx.json({ data: user })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}
```

### 3. Integration Test

Wire everything with `createTestModule` and hit endpoints with supertest:

```ts
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

describe('UserController', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(USER_REPOSITORY, () => new InMemoryUserRepository())
        c.register(TestUserController, TestUserController)
      },
      routes: () => ({
        path: '/users',
        router: buildRoutes(TestUserController),
        controller: TestUserController,
      }),
    })
  }

  it('GET /api/v1/users returns user list', async () => {
    const { app } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(app.handle.bind(app)).get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('GET /api/v1/users/:id returns 404 for unknown', async () => {
    const { app } = await createTestApp({ modules: [buildTestModule()] })
    await request(app.handle.bind(app)).get('/api/v1/users/unknown').expect(404)
  })

  it('DELETE removes and reduces count', async () => {
    const { app } = await createTestApp({ modules: [buildTestModule()] })
    await request(app.handle.bind(app)).delete('/api/v1/users/u1').expect(204)
    const res = await request(app.handle.bind(app)).get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(0)
  })
})
```

## Testing Auth Middleware

Test that protected routes reject invalid tokens and accept valid ones:

```ts
import jwt from 'jsonwebtoken'
import { Controller, Get, Middleware, HttpException } from '@forinda/kickjs'
import type { MiddlewareHandler } from '@forinda/kickjs'

const TEST_SECRET = 'test-secret-that-is-at-least-32-chars-long!'

// Replicate auth logic with a known test secret
const testAuthMiddleware: MiddlewareHandler = (ctx, next) => {
  const header = ctx.req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Missing or invalid authorization header')
  }
  try {
    const payload = jwt.verify(header.slice(7), TEST_SECRET) as jwt.JwtPayload
    ctx.set('user', { id: payload.sub!, email: payload.email })
  } catch {
    throw HttpException.unauthorized('Invalid or expired token')
  }
  next()
}

@Controller()
@Middleware(testAuthMiddleware)
class ProtectedController {
  @Get('/me')
  async me(ctx: RequestContext) {
    ctx.json({ data: ctx.get('user') })
  }
}

// Tests
it('rejects requests without token', async () => {
  const { app } = await createTestApp({ modules: [buildProtectedModule()] })
  await request(app.handle.bind(app)).get('/api/v1/protected/me').expect(401)
})

it('accepts valid JWT', async () => {
  const { app } = await createTestApp({ modules: [buildProtectedModule()] })
  const token = jwt.sign({ sub: 'u1', email: 'alice@test.com' }, TEST_SECRET, { expiresIn: '1h' })

  const res = await request(app.handle.bind(app))
    .get('/api/v1/protected/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)

  expect(res.body.data.id).toBe('u1')
})

it('rejects expired tokens', async () => {
  const { app } = await createTestApp({ modules: [buildProtectedModule()] })
  const token = jwt.sign({ sub: 'u1' }, TEST_SECRET, { expiresIn: '-1s' })

  await request(app.handle.bind(app))
    .get('/api/v1/protected/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(401)
})
```

## Testing Adapters

Test that adapters run their lifecycle hooks:

```ts
import type { AppAdapter } from '@forinda/kickjs'

it('adapter hooks fire during setup', async () => {
  const order: string[] = []
  const adapter: AppAdapter = {
    name: 'TestAdapter',
    beforeMount: () => order.push('beforeMount'),
    beforeStart: () => order.push('beforeStart'),
  }

  await createTestApp({ modules: [SomeModule], adapters: [adapter] })
  expect(order).toEqual(['beforeMount', 'beforeStart'])
})
```

## Testing File Uploads

Use supertest's `.attach()` method with the `upload` middleware:

```ts
import { Controller, Post, Middleware } from '@forinda/kickjs'
import { upload } from '@forinda/kickjs'

@Controller()
class UploadController {
  @Post('/')
  @Middleware(upload.single('file', { maxSize: 5 * 1024 * 1024 }))
  async handleUpload(ctx: RequestContext) {
    ctx.json({ filename: ctx.file?.originalname, size: ctx.file?.size })
  }
}

// Test
it('accepts file upload', async () => {
  const { app } = await createTestApp({ modules: [buildUploadModule()] })

  const res = await request(app.handle.bind(app))
    .post('/api/v1/uploads')
    .attach('file', Buffer.from('hello world'), 'test.txt')
    .expect(200)

  expect(res.body.filename).toBe('test.txt')
  expect(res.body.size).toBe(11)
})

it('rejects files exceeding size limit', async () => {
  const { app } = await createTestApp({ modules: [buildUploadModule()] })
  const largeBuffer = Buffer.alloc(6 * 1024 * 1024) // 6MB > 5MB limit

  await request(app.handle.bind(app))
    .post('/api/v1/uploads')
    .attach('file', largeBuffer, 'big.bin')
    .expect(413)
})
```

## Environment Isolation

Load order decides this, so start there. Two things happen **before any
`beforeAll` runs**:

1. Importing `@forinda/kickjs` reads your env file into `process.env` as an
   import-time side effect.
2. Your `loadEnv(envSchema)` call parses `process.env` **once** and caches the
   result. `ConfigService.get()` and `@Value()` read that cached snapshot, not
   `process.env`.

So a var must be set before the module graph is imported. The reliable
placements are a `.env.test` file, your runner's `env` config, or a
`setupFiles` entry that runs first.

### `.env.test` — the default

KickJS uses the same env-file cascade Vite popularised (see its "Env Variables
and Modes" guide): a mode-specific file outranks every generic one, and keys
found only in a generic file are still available.

```text
.env.[mode].local  >  .env.[mode]  >  .env.local  >  .env
```

`[mode]` is your `NODE_ENV`. Vars already in `process.env` outrank all four, so
what your shell or CI exports always wins. `*.local` files are for personal
machine overrides — add `*.local` to `.gitignore`.

::: warning What this does and does not protect against
`.env.test` closes one specific hole: values reaching your suite from an env
**file** it never meant to read. It is not a general guard against pointing a
test at the wrong resource.

Anything already in `process.env` — a var exported in your shell, set by your
CI job, or injected by a test-container runner — outranks every file and is
never reported by the backfill warning. That precedence is deliberate and is
what lets a runner hand your suite a throwaway database URL. It also means an
exported `DATABASE_URL` aimed at the wrong host is invisible here.

For that failure mode you want an explicit assertion at the point of use — a
few lines refusing to run against a database whose name isn't the test one
beat any amount of env plumbing, because they check the thing you actually
care about.
:::

**Test mode is the one exception.** Under a test run, if a `.env.test` or
`.env.test.local` exists, those are read and the generic `.env` / `.env.local`
are **not**. No layering, no fallback.

A run counts as a test run when `NODE_ENV=test` **or** Vitest's `VITEST` is set.
`VITEST` wins over a conflicting `NODE_ENV`, so a suite run with
`NODE_ENV=development` exported — from a shell profile or a CI image — still
gets test-mode isolation rather than your development files. To point a suite at
another mode's files deliberately, name them with `KICKJS_ENV_FILE`.

That short-circuit is deliberate. With a fallback, every var your test config
forgets to pin gets silently backfilled from your development `.env`: you can
pin your database URL and still reach live development services through the
vars you forgot, and nothing in the run tells you. `.env.local` is excluded for
the same reason — it is precisely the file holding one developer's machine
setup.

For `development` and `production` the layering is what you want (shared base
plus per-mode overrides) and there is no dev-resource-in-a-test failure mode to
guard against, so those cascade normally.

```bash
# .env.test — checked in; the whole environment your suite runs against
NODE_ENV=test
DATABASE_URL=postgresql://test@localhost/myapp_test
LOG_LEVEL=silent
```

With no `.env.test` present, `.env` is read as before and KickJS prints a
one-time warning naming what it backfilled.

**Commit `.env.test`.** Unlike `.env`, it belongs in version control — that is
the difference between _everyone_ on the team being isolated and only whoever
wrote the file locally. It is shared, reviewable test configuration, so a
teammate's fresh clone and CI get the same isolation you do. `kick new`
gitignores `.env` and `*.local` and leaves `.env.test` tracked.

The corollary is that it must not hold real credentials or live endpoints —
point it at test doubles or throwaway containers. A shared database URL sitting
in a committed `.env.test` rebuilds the trap: a whole team, and CI, quietly
aimed at one box. Compute per-run values (a container's port, a worker-scoped
database name) in your test config or setup file instead, where they stay out
of the repo and `process.env` still outranks the file.

### `KICKJS_ENV_FILE` — taking manual control

`KICKJS_ENV_FILE` replaces the whole cascade with a list you choose. It accepts
a comma-separated list of paths, **highest precedence first**, or `off` to skip
dotenv entirely:

```bash
# Skip env files completely — env comes from the shell, Docker, or a
# secret manager. Nothing on disk can leak in.
KICKJS_ENV_FILE=off vitest run

# One file, nothing else. Not even .env is consulted.
KICKJS_ENV_FILE=.env.ci vitest run
```

Order is precedence, so put the file that should win **first**. This is the
manual equivalent of the built-in cascade — a base file plus overrides layered
on top:

```bash
# .env.ci wins on conflicts; .env.shared supplies everything it omits.
KICKJS_ENV_FILE=.env.ci,.env.shared vitest run
```

```bash
# Three layers: a per-developer file beats the team's test defaults,
# which beat the shared base.
KICKJS_ENV_FILE=.env.test.local,.env.test,.env.shared vitest run
```

Reversing the list reverses the outcome — `.env.shared,.env.ci` lets
`.env.shared` win, which is usually not what you meant:

```bash
# ✗ Wrong way round — the base overrides your CI values.
KICKJS_ENV_FILE=.env.shared,.env.ci vitest run
```

Paths resolve relative to `process.cwd()`, so a monorepo can reach a file the
cascade would never find on its own — note that cwd is the **package** dir when
run through a workspace filter, not the repo root:

```bash
# Layer a repo-root file under the package's own.
KICKJS_ENV_FILE=.env.test,../../.env.shared pnpm --filter api test
```

Missing files in the list are skipped silently, so an optional local override
costs nothing:

```bash
# Works whether or not .env.test.local exists.
KICKJS_ENV_FILE=.env.test.local,.env.test vitest run
```

Set it per command as above, or pin it for a whole suite from the runner —
which also keeps it out of individual developers' shells:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    env: { KICKJS_ENV_FILE: '.env.ci,.env.shared' },
  },
})
```

One caveat: vars already present in `process.env` still outrank every file in
the list, `KICKJS_ENV_FILE` included. It picks which files are read, not whether
files beat the environment.

### `vi.stubEnv()` mid-suite

`vi.stubEnv()` mutates `process.env`, which is already too late for anything
read through `ConfigService` / `@Value()` — the parse happened at import. To
make a stub take effect, drop the cache and re-parse:

```ts
import { vi, beforeAll, afterAll } from 'vitest'
import { loadEnv, resetEnvCache } from '@forinda/kickjs'
import { envSchema } from '../src/env'

beforeAll(() => {
  vi.stubEnv('JWT_SECRET', 'test-secret-with-at-least-32-chars')
  resetEnvCache()
  loadEnv(envSchema)
})

afterAll(() => {
  vi.unstubAllEnvs()
  // `unstubAllEnvs()` restores process.env, but the cached parse still
  // holds the stub — drop it too, or a later test in the same worker
  // reads your stubbed value through ConfigService / @Value().
  resetEnvCache()
  loadEnv(envSchema)
})
```

Your stub has to satisfy the schema: `loadEnv(envSchema)` re-validates, so a
`JWT_SECRET` declared `z.string().min(32)` rejects a 30-character placeholder.

`vi.stubEnv()` alone is still correct for code that reads `process.env`
directly.

## Container Isolation

For concurrent test environments (`--pool threads`), use isolated containers:

```ts
const { app } = await createTestApp({
  modules: [UserModule],
  isolated: true, // uses Container.create() instead of Container.reset()
})
```

## Generated Tests

When you scaffold a module with `kick g module`, the CLI generates test stubs automatically:

```bash
kick g module user
# Creates:
#   __tests__/user.controller.test.ts  — HTTP integration test scaffold
#   __tests__/user.repository.test.ts  — InMemoryRepository unit tests
```

When you generate a module with a custom repo name (e.g. `--repo postgres`), the generator creates **both** the custom repository stub and an in-memory repository for testing. The in-memory repo implements the same interface, so tests run without a database.

```
src/modules/users/
  postgres-user.repository.ts     # Production — wire to your DB client
  in-memory-user.repository.ts    # Testing — in-memory stub
  __tests__/
    user.repository.test.ts       # Imports InMemoryUserRepository
```

The generated tests are scaffolds with real assertions. Customize them for your domain logic.

## Tips

- Always `await createTestApp()` — it's async
- Use `beforeEach(() => Container.reset())` for serial test isolation
- Use `isolated: true` for concurrent tests
- Test controllers without auth by creating test-only controllers
- Put test env in `.env.test` — it wins outright and never falls back to `.env`
- `vi.stubEnv()` after import needs `resetEnvCache()` + `loadEnv()` to reach `ConfigService`
- The returned `app` works directly with supertest via `app.handle.bind(app)` — no server needed, on any runtime
- Adapter lifecycle hooks (`beforeMount`, `beforeStart`) still run during setup
- Generated tests work out of the box — `kick g module user && npx vitest run`
