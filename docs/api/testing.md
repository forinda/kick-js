# @forinda/kickjs-testing

Test utilities for creating isolated KickJS application instances with DI overrides.

## createTestApp

Create an Application configured for testing. Resets the DI container, registers modules, applies overrides, and returns the Application and container. Uses a minimal middleware stack — no helmet, cors, compression or morgan.

```typescript
async function createTestApp(options: CreateTestAppOptions): Promise<{
  app: Application
  /** @deprecated Express-only — throws under any other runtime. Use `app.handle`. */
  expressApp: express.Express
  container: Container
}>
```

It is **async** — `await` it, or supertest receives a Promise.

**Drive `app`, not `expressApp`.** `app.handle` is the Application's own Node request listener and follows whichever runtime is configured, so one suite runs against every engine. `expressApp` is deprecated and throws under Fastify or h3 rather than handing back that engine's instance mistyped as `express.Express` — which is how a suite ends up silently exercising the wrong runtime.

```typescript
import request from 'supertest'
import { createToken } from '@forinda/kickjs'

const { app, container } = await createTestApp({
  modules: [UserModule()],
  overrides: [[USER_REPO, new InMemoryUserRepo()]],
})

const res = await request(app.handle.bind(app)).get('/api/v1/users').expect(200)
```

### Testing the runtime you deploy

Pass `runtime` — the same value given to `bootstrap()`. Routing, body parsing, status handling and error mapping all live in the runtime seam, so a green Express suite says nothing about them if you ship Fastify.

```typescript
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { app } = await createTestApp({
  modules: [UserModule()],
  runtime: fastifyRuntime(),
})
```

The default middleware follows the runtime: empty on an engine that parses bodies natively, `[express.json()]` otherwise. Passing `middlewares: [express.json()]` explicitly on Fastify bypasses the Application's own native-body guard — the connect parser then consumes the stream before Fastify reads it, and a JSON POST hangs until the test times out.

### Overriding a token

`createToken()` returns a frozen **object** identified by reference, which TypeScript rejects as a computed property key (`TS2464`). Pass entries or a `Map` instead:

```typescript
const DATABASE = createToken<Database>('app/Db/connection')

await createTestApp({
  modules: [UserModule()],
  overrides: [[DATABASE, fakeDb()]], // or: new Map([[DATABASE, fakeDb()]])
})
```

::: warning Do not reach for `[TOKEN.name]`
It compiles — `name` is a string — and does nothing. The container keys tokens by **reference**, so the override is accepted and never applied, and the test passes against the real implementation.
:::

The object form still works for string and symbol keys.

## createTestModule

Build a quick test module that explicitly registers dependencies and declares routes. Useful for integration tests that need fine-grained control over the DI graph.

```typescript
function createTestModule(config: {
  register: (container: Container) => void
  routes: () => ModuleRoutes | ModuleRoutes[] | null
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

const { app } = await createTestApp({ modules: [TestModule] })
```

## CreateTestAppOptions

```typescript
interface CreateTestAppOptions {
  /** Class form (`class UserModule extends AppModule`) or `defineModule` factory output (`UserModule()`). */
  modules: AppModuleEntry[]
  /** Adapters to attach (queue, devtools, your own auth adapter, …). */
  adapters?: AppAdapter[]
  /** DI overrides applied after module registration. Entries or a Map preserve token identity. */
  overrides?:
    | Record<symbol | string, any>
    | ReadonlyArray<readonly [token: unknown, value: unknown]>
    | ReadonlyMap<unknown, unknown>
  /** Isolated container instead of the global singleton — safe for concurrent tests. */
  isolated?: boolean

  // Forwarded verbatim to the underlying Application:
  /** The engine under test — `expressRuntime()` (default), `fastifyRuntime()`, `h3Runtime()`. */
  runtime?: HttpRuntime
  /** Mount the built-in health module. Default: true. */
  health?: boolean
  middlewares?: MiddlewareEntry[]
  port?: number
  apiPrefix?: string
  defaultVersion?: number | false
  contributors?: ContributorRegistration[]
  contextStore?: 'auto' | 'manual'
  plugins?: KickPlugin[]
  onError?: ApplicationOptions['onError']
  onNotFound?: ApplicationOptions['onNotFound']
  trustProxy?: boolean | number | string
  jsonLimit?: string
  security?: ApplicationOptions['security']
}
```

## createTestPlugin

Exercise a plugin's hooks without booting an app. Registers the plugin into a container and hands back lifecycle invokers plus whatever it contributed. Aliased as `testPlugin`.

```typescript
async function createTestPlugin(
  plugin: KickPlugin,
  options?: CreateTestPluginOptions,
): Promise<PluginTestHarness>

interface CreateTestPluginOptions {
  /** Isolated container, never touching the global singleton. Default: true. */
  isolated?: boolean
  /** Skip the eager `plugin.register(container)` — to assert container state before it runs. Default: false. */
  skipRegister?: boolean
}

interface PluginTestHarness {
  readonly plugin: KickPlugin
  readonly container: Container

  callOnReady(): Promise<void>
  shutdown(): Promise<void>

  /** What the plugin ships. These are getters, not properties — call them. */
  modules(): AppModuleEntry[]
  adapters(): AppAdapter[]
  middleware(): any[]
  contributors(): ContributorRegistration[]

  makeContext(initial?: Record<string, unknown>): ExecutionContext
  runContributors(ctx: ExecutionContext): Promise<void>
}
```

`modules()` returns the module classes without instantiating them — use `createTestApp` for that. It answers "does the plugin expose the module I expect", not "does that module work".

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
  resolve: (ctx, { repo }) => (repo as ProjectsRepo).find(ctx.require('tenant').id, 'p-1'),
})

const { value } = await runContributor(LoadProject, {
  initial: { tenant: { id: 't-1' } },
  deps: { repo: new InMemoryProjectsRepo([{ id: 'p-1', tenantId: 't-1' }]) },
})
expect(value).toEqual({ id: 'p-1', tenantId: 't-1' })
```

Errors thrown by `resolve()` propagate so tests can `await expect(...).rejects.toThrow()` against them. To exercise the full §20.9 error matrix (`optional` skip, `onError` replacement), build a one-element pipeline with `buildPipeline()` and use `runContributors()` from `@forinda/kickjs` instead.

See [Context Decorators](../guide/context-decorators.md) for the full pipeline reference.
