# @forinda/kickjs-testing

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
  /** Global Context Contributors (#107) — same as ApplicationOptions.contributors. */
  contributors?: ContributorRegistration[]
  /** ALS strategy. 'auto' (default) or 'manual'. Same as ApplicationOptions.contextStore. */
  contextStore?: 'auto' | 'manual'
}
```

## runContributor

Run a single Context Contributor in isolation against a fake `ExecutionContext`. Skips the DI container, the topo-sort, and the §20.9 error matrix — calls `decorator.registration.resolve(ctx, deps)` directly so unit tests can assert pure resolve behaviour.

```typescript
async function runContributor<K extends string, D extends Record<string, any>>(
  decorator: ContextDecorator<K, D, ExecutionContext>,
  options?: {
    /** Resolved deps passed to resolve() — skips container lookup. */
    deps?: Record<string, unknown>
    /** Pre-populates the fake ctx metadata so dependsOn-style reads succeed. */
    initial?: Record<string, unknown>
    /** Override the fake ctx requestId (default: 'test-req'). */
    requestId?: string
  },
): Promise<{
  /** Value returned by resolve() — typed via ContextMeta[K]. */
  value: MetaValue<K>
  /** The fake ExecutionContext used during the run. */
  ctx: ExecutionContext
  /** Final state of the metadata Map (includes any ctx.set() side effects). */
  meta: Map<string, unknown>
}>
```

```ts
import { runContributor } from '@forinda/kickjs-testing'
import { defineContextDecorator } from '@forinda/kickjs'

const LoadProject = defineContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  deps: { repo: ProjectsRepo },
  resolve: (ctx, { repo }) => (repo as ProjectsRepo).find(ctx.get('tenant')!.id, 'p-1'),
})

const { value } = await runContributor(LoadProject, {
  initial: { tenant: { id: 't-1' } },
  deps: { repo: new InMemoryProjectsRepo([{ id: 'p-1', tenantId: 't-1' }]) },
})
expect(value).toEqual({ id: 'p-1', tenantId: 't-1' })
```

Errors thrown by `resolve()` propagate so tests can `await expect(...).rejects.toThrow()` against them. To exercise the full §20.9 error matrix (`optional` skip, `onError` replacement), build a one-element pipeline with `buildPipeline()` and use `runContributors()` from `@forinda/kickjs` instead.

See [Context Decorators](../guide/context-decorators.md) for the full pipeline reference.
