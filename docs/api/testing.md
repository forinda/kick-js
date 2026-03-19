# @kickjs/testing

Test utilities for creating isolated KickJS application instances with DI overrides.

## createTestApp

Create an Application instance configured for testing. Resets the DI container, registers modules, applies overrides, and returns the Application, Express app, and container. Uses a minimal middleware stack (no helmet, cors, compression, or morgan).

```typescript
function createTestApp(options: CreateTestAppOptions): {
  app: Application
  expressApp: any
  container: Container
}
```

**Example:**

```typescript
const { expressApp, container } = createTestApp({
  modules: [UserModule],
  overrides: {
    userRepository: new InMemoryUserRepo(),
  },
})

const res = await supertest(expressApp).get('/api/v1/users').expect(200)
```

## createTestModule

Build a quick test module that explicitly registers dependencies and declares routes. Useful for integration tests that need fine-grained control over the DI graph.

```typescript
function createTestModule(config: {
  register: (container: Container) => void
  routes: () => ModuleRoutes | ModuleRoutes[]
}): AppModuleClass
```

**Example:**

```typescript
const TestModule = createTestModule({
  register: (c) => {
    c.registerInstance('repo', new MockRepo())
  },
  routes: () => ({
    path: '/items',
    router: buildRoutes(ItemController),
    controller: ItemController,
  }),
})

const { expressApp } = createTestApp({ modules: [TestModule] })
```

## CreateTestAppOptions

```typescript
interface CreateTestAppOptions {
  modules: AppModuleClass[]
  overrides?: Record<symbol | string, any>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
}
```
