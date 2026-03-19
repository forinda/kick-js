# Testing

The `@forinda/kickjs-testing` package provides utilities for integration testing KickJS applications. It works with Vitest and supertest to test HTTP endpoints with full DI container support.

## createTestApp

Create an Application instance configured for testing. This resets the DI container, applies an empty middleware stack (no helmet, cors, or compression), and runs `setup()` without starting an HTTP server:

```ts
import { createTestApp } from '@forinda/kickjs-testing'
import { UserModule } from '../src/modules/users'

const { app, expressApp, container } = createTestApp({
  modules: [UserModule],
})
```

### Options

```ts
interface CreateTestAppOptions {
  modules: AppModuleClass[]
  overrides?: Record<symbol | string, any>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
}
```

### DI Overrides

Pass mock implementations via the `overrides` option. These are registered as instances in the container before setup runs:

```ts
const mockRepo = {
  findAll: async () => [{ id: '1', name: 'Test' }],
  findById: async (id: string) => ({ id, name: 'Test' }),
  create: async (dto: any) => ({ id: '1', ...dto }),
  update: async (id: string, dto: any) => ({ id, ...dto }),
  delete: async () => {},
}

const { expressApp } = createTestApp({
  modules: [UserModule],
  overrides: {
    [USER_REPOSITORY.toString()]: mockRepo,
  },
})
```

## createTestModule

Build a quick test module when you need full control over the DI graph:

```ts
import { createTestModule, createTestApp } from '@forinda/kickjs-testing'
import { buildRoutes } from '@forinda/kickjs-http'

const TestModule = createTestModule({
  register: (container) => {
    container.registerInstance(DB_TOKEN, mockDb)
    container.register(MyService, MyService)
  },
  routes: () => ({
    path: '/test',
    router: buildRoutes(MyController),
    controller: MyController,
  }),
})

const { expressApp } = createTestApp({ modules: [TestModule] })
```

## HTTP Testing with Supertest

Use the `expressApp` returned by `createTestApp` with supertest:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '@forinda/kickjs-testing'
import { ProductModule } from '../src/modules/products'

describe('Products API', () => {
  let expressApp: any

  beforeEach(() => {
    const result = createTestApp({
      modules: [ProductModule],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    expressApp = result.expressApp
  })

  it('POST /api/v1/products creates a product', async () => {
    const res = await request(expressApp)
      .post('/api/v1/products')
      .send({ name: 'Widget' })
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body.name).toBe('Widget')
  })

  it('GET /api/v1/products lists products', async () => {
    const res = await request(expressApp)
      .get('/api/v1/products')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /api/v1/products/:id returns 404 for missing', async () => {
    await request(expressApp)
      .get('/api/v1/products/nonexistent')
      .expect(404)
  })
})
```

## Container Isolation

Call `Container.reset()` in `beforeEach` to ensure tests do not share singleton state. The `createTestApp` function calls `Container.reset()` internally, so if you create a fresh test app per test, isolation is automatic:

```ts
import { Container } from '@forinda/kickjs-core'

beforeEach(() => {
  Container.reset()
})
```

`Container.reset()` destroys the current singleton container and forces `Container.getInstance()` to create a new one. All registered classes, factories, and instances are cleared.

## Testing without HTTP

You can test services directly by using the container:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Container, Scope } from '@forinda/kickjs-core'

describe('UserService', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('resolves with injected dependencies', () => {
    const container = Container.getInstance()
    container.registerInstance(DB_TOKEN, mockDb)
    container.register(UserService, UserService, Scope.SINGLETON)

    const service = container.resolve(UserService)
    expect(service).toBeDefined()
  })
})
```

## Tips

- Always call `createTestApp` or `Container.reset()` in `beforeEach` to prevent test pollution.
- Use the `overrides` option to swap real database repositories with in-memory mocks.
- The test app uses an empty middleware array by default, so authentication middleware is not applied unless you explicitly add it.
- Adapter lifecycle hooks (`beforeMount`, `beforeStart`) still run during `setup()`. Pass adapters in the test app options if you need them.
- The `expressApp` works directly with supertest -- no need to start a server or bind a port.
