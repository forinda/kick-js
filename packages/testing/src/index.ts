import express from 'express'
import {
  Application,
  Container,
  type AppAdapter,
  type AppModule,
  type AppModuleClass,
  type ApplicationOptions,
  type ContextDecorator,
  type ExecutionContext,
  type MetaValue,
  type ModuleRoutes,
} from '@forinda/kickjs'

/**
 * Bootstrap options forwarded verbatim to the underlying Application so
 * test apps exercise the same HTTP pipeline shape as production.
 */
type BootstrapPassthroughOptions = Pick<
  ApplicationOptions,
  | 'port'
  | 'apiPrefix'
  | 'defaultVersion'
  | 'middleware'
  | 'onError'
  | 'onNotFound'
  | 'plugins'
  | 'trustProxy'
  | 'jsonLimit'
  | 'security'
  | 'contributors'
  | 'contextStore'
>

/**
 * Options for creating a test application.
 * Disables helmet, cors, compression, and morgan by default.
 */
export interface CreateTestAppOptions extends BootstrapPassthroughOptions {
  modules: AppModuleClass[]
  /** Adapters to attach (auth, queue, devtools, etc.) */
  adapters?: AppAdapter[]
  /** DI overrides applied after module registration. Supports both string and symbol keys. */
  overrides?: Record<symbol | string, any>
  /**
   * Use an isolated container instead of the global singleton.
   * Prevents concurrent tests from interfering with each other's DI state.
   * When true, Container.create() is used instead of Container.reset() + getInstance().
   */
  isolated?: boolean
}

/**
 * Create an Application instance configured for testing.
 * Resets the DI container, registers modules, applies overrides,
 * and returns both the Application and its Express app.
 *
 * @example
 * ```ts
 * const { expressApp, container } = await createTestApp({
 *   modules: [UserModule],
 *   overrides: { [USER_REPO]: new InMemoryUserRepo() },
 * })
 * const res = await request(expressApp).get('/api/v1/users')
 * ```
 */
export async function createTestApp(options: CreateTestAppOptions): Promise<{
  app: Application
  expressApp: express.Express
  container: Container
}> {
  let container: Container
  if (options.isolated) {
    // Isolated container — safe for concurrent tests
    container = Container.create()
  } else {
    // Global singleton — reset for serial test isolation (default)
    Container.reset()
    container = Container.getInstance()
  }

  const app = new Application({
    modules: options.modules,
    adapters: options.adapters,
    port: options.port,
    apiPrefix: options.apiPrefix,
    defaultVersion: options.defaultVersion,
    // Use provided middleware, or default to JSON body parsing only
    middleware: options.middleware ?? [express.json()],
    onError: options.onError,
    onNotFound: options.onNotFound,
    plugins: options.plugins,
    trustProxy: options.trustProxy,
    jsonLimit: options.jsonLimit,
    security: options.security,
    contributors: options.contributors,
    contextStore: options.contextStore,
  })

  // Run setup — mounts routes, registers modules, initializes adapters.
  // Awaited to support future async adapter hooks.
  await Promise.resolve(app.setup())

  // When using an isolated container, Application.setup() registers modules
  // on the global singleton (Container.getInstance()). Re-register them on
  // the isolated container so that bindings are available there too.
  if (options.isolated) {
    for (const ModuleClass of options.modules) {
      const mod = new ModuleClass()
      // register() is optional — see AppModule docs
      mod.register?.(container)
    }
    container.bootstrap()
  }

  // Apply DI overrides AFTER setup so they take precedence over
  // bindings registered by modules during register().
  if (options.overrides) {
    for (const token of Reflect.ownKeys(options.overrides)) {
      container.registerInstance(token, options.overrides[token as any])
    }
  }

  return {
    app,
    expressApp: app.getExpressApp(),
    container,
  }
}

/**
 * Build a quick TestModule that explicitly registers dependencies.
 * Useful for integration tests that need to control the DI graph.
 *
 * @example
 * ```ts
 * const TestModule = createTestModule({
 *   register: (c) => {
 *     c.registerFactory(USER_REPO, () => new InMemoryUserRepo())
 *     c.register(UserController)
 *   },
 *   routes: () => buildRoutes(UserController, '/users'),
 * })
 * ```
 */
export function createTestModule(config: {
  register: (container: Container) => void
  routes: () => ModuleRoutes | ModuleRoutes[] | null
}): AppModuleClass {
  class TestModule implements AppModule {
    register(container: Container) {
      config.register(container)
    }
    routes() {
      return config.routes()
    }
  }
  return TestModule
}

// ── Context Contributor unit-test helper (#107) ─────────────────────────

/**
 * Options for {@link runContributor}.
 */
export interface RunContributorOptions {
  /**
   * Resolved deps passed to `resolve(ctx, deps)`. Skips the DI container
   * entirely — bypass for unit tests that want to assert pure resolve()
   * behaviour without standing up a container.
   *
   * Property names must match the spec's `deps` keys; values can be real
   * service instances, mocks, or test doubles.
   */
  deps?: Record<string, unknown>

  /**
   * Pre-populate the fake context's metadata Map. Useful for testing
   * contributors with `dependsOn` without running the full pipeline:
   * pre-populate the dependency keys, then assert that `resolve()` reads
   * them and produces the expected output.
   */
  initial?: Record<string, unknown>

  /** Override the fake context's `requestId` (default: `'test-req'`). */
  requestId?: string
}

/**
 * Result of {@link runContributor}.
 */
export interface RunContributorResult<K extends string> {
  /** Value returned by the contributor's `resolve()` call. */
  value: MetaValue<K>
  /** The fake `ExecutionContext` used during the run. */
  ctx: ExecutionContext
  /**
   * Final state of the fake context's metadata Map after `resolve()`.
   * Includes any `ctx.set(...)` calls the resolver made plus the final
   * resolved value under the contributor's own key.
   */
  meta: Map<string, unknown>
}

/**
 * Run a single context contributor in isolation against a fake
 * {@link ExecutionContext}. Skips the container, the topo-sort, and the
 * §20.9 error matrix — calls `decorator.registration.resolve(ctx, deps)`
 * directly so unit tests can assert pure resolve behaviour.
 *
 * Errors thrown by `resolve()` propagate so tests can `expect(...).rejects`
 * or `await expect(...).rejects.toThrow()` against them. To exercise the
 * full error matrix (optional skip, onError replacement, etc.), build a
 * one-element pipeline with `buildPipeline()` and use `runContributors()`
 * directly.
 *
 * @example
 * ```ts
 * const LoadProject = defineContextDecorator({
 *   key: 'project',
 *   dependsOn: ['tenant'],
 *   deps: { repo: ProjectRepo },
 *   resolve: (ctx, { repo }) => repo.findByTenant(ctx.get('tenant')!.id),
 * })
 *
 * const { value } = await runContributor(LoadProject, {
 *   initial: { tenant: { id: 't-1' } },
 *   deps: { repo: new InMemoryProjectRepo([{ id: 'p-1', tenantId: 't-1' }]) },
 * })
 * expect(value).toEqual({ id: 'p-1', tenantId: 't-1' })
 * ```
 */
export async function runContributor<
  K extends string,
  D extends Record<string, any> = Record<string, never>,
>(
  decorator: ContextDecorator<K, D, ExecutionContext>,
  options: RunContributorOptions = {},
): Promise<RunContributorResult<K>> {
  const meta = new Map<string, unknown>(Object.entries(options.initial ?? {}))
  const ctx: ExecutionContext = {
    get(key) {
      return meta.get(key) as never
    },
    set(key, value) {
      meta.set(key, value)
    },
    requestId: options.requestId ?? 'test-req',
  }

  const value = await decorator.registration.resolve(ctx, (options.deps ?? {}) as never)
  meta.set(decorator.registration.key, value)

  return { value: value as MetaValue<K>, ctx, meta }
}
