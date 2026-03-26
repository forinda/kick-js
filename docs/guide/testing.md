# Testing

The `@forinda/kickjs-testing` package provides utilities for integration testing KickJS applications. Works with Vitest and supertest.

## Setup

```bash
pnpm add -D @forinda/kickjs-testing supertest @types/supertest vitest
```

## createTestApp

Creates an Application instance for testing — resets DI, runs `setup()`, returns the Express app for supertest:

```ts
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule } from '../src/modules/users'

const { expressApp, container } = await createTestApp({
  modules: [UserModule],
})
```

::: tip
`createTestApp` is **async** — always `await` it.
:::

### Options

```ts
interface CreateTestAppOptions {
  modules: AppModuleClass[]
  adapters?: AppAdapter[]
  overrides?: Record<symbol | string, any>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
  middleware?: express.RequestHandler[] // replaces default (express.json())
  isolated?: boolean // use Container.create() instead of reset()
}
```

## Testing a DDD Module

The recommended pattern: create an in-memory repository, wire a test controller without auth, and test via supertest.

### 1. In-Memory Repository

Implement the repository interface with a plain array:

```ts
import type { IUserRepository, User, NewUser } from '../domain/repositories/user.repository'

class InMemoryUserRepository implements IUserRepository {
  private users: User[] = [
    { id: 'u1', email: 'alice@test.com', firstName: 'Alice', /* ... */ },
  ]

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
import { Controller, Get, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
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
import { Container } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
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
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('GET /api/v1/users/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/users/unknown').expect(404)
  })

  it('DELETE removes and reduces count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/users/u1').expect(204)
    const res = await request(expressApp).get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(0)
  })
})
```

## Testing Auth Middleware

Test that protected routes reject invalid tokens and accept valid ones:

```ts
import jwt from 'jsonwebtoken'
import { Controller, Get, Middleware, HttpException } from '@forinda/kickjs-core'
import type { MiddlewareHandler } from '@forinda/kickjs-core'

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
  const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })
  await request(expressApp).get('/api/v1/protected/me').expect(401)
})

it('accepts valid JWT', async () => {
  const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })
  const token = jwt.sign({ sub: 'u1', email: 'alice@test.com' }, TEST_SECRET, { expiresIn: '1h' })

  const res = await request(expressApp)
    .get('/api/v1/protected/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)

  expect(res.body.data.id).toBe('u1')
})

it('rejects expired tokens', async () => {
  const { expressApp } = await createTestApp({ modules: [buildProtectedModule()] })
  const token = jwt.sign({ sub: 'u1' }, TEST_SECRET, { expiresIn: '-1s' })

  await request(expressApp)
    .get('/api/v1/protected/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(401)
})
```

## Testing Adapters

Test that adapters run their lifecycle hooks:

```ts
import type { AppAdapter } from '@forinda/kickjs-core'

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
import { Controller, Post, Middleware } from '@forinda/kickjs-core'
import { upload } from '@forinda/kickjs-http'

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
  const { expressApp } = await createTestApp({ modules: [buildUploadModule()] })

  const res = await request(expressApp)
    .post('/api/v1/uploads')
    .attach('file', Buffer.from('hello world'), 'test.txt')
    .expect(200)

  expect(res.body.filename).toBe('test.txt')
  expect(res.body.size).toBe(11)
})

it('rejects files exceeding size limit', async () => {
  const { expressApp } = await createTestApp({ modules: [buildUploadModule()] })
  const largeBuffer = Buffer.alloc(6 * 1024 * 1024) // 6MB > 5MB limit

  await request(expressApp)
    .post('/api/v1/uploads')
    .attach('file', largeBuffer, 'big.bin')
    .expect(413)
})
```

## Environment Isolation

Use `vi.stubEnv()` to set env vars without leaking to other tests:

```ts
import { vi, beforeAll, afterAll } from 'vitest'

beforeAll(() => {
  vi.stubEnv('JWT_SECRET', 'test-secret-32-chars-minimum!!')
  vi.stubEnv('DATABASE_URL', 'postgresql://test@localhost/test')
})

afterAll(() => {
  vi.unstubAllEnvs()
})
```

::: warning
Never use `process.env.X = 'value'` directly — it leaks across tests. Always use `vi.stubEnv()`.
:::

## Container Isolation

For concurrent test environments (`--pool threads`), use isolated containers:

```ts
const { expressApp } = await createTestApp({
  modules: [UserModule],
  isolated: true, // uses Container.create() instead of Container.reset()
})
```

## Tips

- Always `await createTestApp()` — it's async
- Use `beforeEach(() => Container.reset())` for serial test isolation
- Use `isolated: true` for concurrent tests
- Test controllers without auth by creating test-only controllers
- Use `vi.stubEnv()` for env vars, never raw `process.env`
- The `expressApp` works directly with supertest — no server needed
- Adapter lifecycle hooks (`beforeMount`, `beforeStart`) still run during setup
