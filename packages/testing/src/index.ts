import express from 'express'
import {
  Application,
  Container,
  buildPipeline,
  runContributors,
  type AppAdapter,
  type AppModule,
  type AppModuleClass,
  type AppModuleEntry,
  type ApplicationOptions,
  type ContextDecorator,
  type ContextMetaKey,
  type ContributorRegistration,
  type ExecutionContext,
  MissingContextValueError,
  type KickPlugin,
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
  // The engine under test. Without this every test ran Express while
  // production ran Fastify or h3 — the one thing an integration test exists
  // to rule out.
  | 'runtime'
>

/**
 * Options for creating a test application.
 * Disables helmet, cors, compression, and morgan by default.
 */
export interface CreateTestAppOptions extends BootstrapPassthroughOptions {
  /**
   * Modules registered for the test run. Accepts both legacy class form
   * (`UserModule extends AppModule`) and `defineModule` factory output
   * (call the factory: `UserModule()`) — `Application` discriminates
   * at boot.
   */
  modules: AppModuleEntry[]
  /** Adapters to attach (auth, queue, devtools, etc.) */
  adapters?: AppAdapter[]
  /**
   * DI overrides applied after module registration.
   *
   * An object literal covers string and symbol keys. It cannot cover
   * `createToken()`, though — a token is a frozen OBJECT identified by
   * reference, and TypeScript rejects an object as a computed key
   * (`TS2464: A computed property name must be of type 'string', 'number',
   * 'symbol', or 'any'`). Since tokens are the documented way to bind an
   * interface to an implementation, that excluded exactly the key type most
   * worth overriding in a test.
   *
   * Worse, the obvious workaround compiles and does nothing: `[TOKEN.name]` is
   * a string, and the container keys tokens by reference, so the override is
   * accepted and never applied.
   *
   * Pass entries to override a token:
   *
   * ```ts
   * const DATABASE = createToken<Database>('app/Db/connection')
   *
   * await createTestApp({
   *   modules: [UserModule()],
   *   overrides: [[DATABASE, fakeDb()]],
   * })
   * ```
   *
   * A `Map` works too. The object form is unchanged.
   */
  overrides?:
    | Record<symbol | string, any>
    | ReadonlyArray<readonly [token: unknown, value: unknown]>
    | ReadonlyMap<unknown, unknown>
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
 * and returns the Application, which drives whichever runtime is configured.
 *
 * Drive it through `app` — `app.handle` is the Application's own Node request
 * listener and follows whichever runtime is configured, so the same test runs
 * against the engine you actually deploy.
 *
 * @example
 * ```ts
 * const { app, container } = await createTestApp({
 *   modules: [UserModule],
 *   overrides: { [USER_REPO]: new InMemoryUserRepo() },
 * })
 * const res = await request(app.handle.bind(app)).get('/api/v1/users')
 * ```
 *
 * @example Test the engine you actually deploy
 * ```ts
 * import { fastifyRuntime } from '@forinda/kickjs/fastify'
 *
 * const { app } = await createTestApp({ modules: [UserModule], runtime: fastifyRuntime() })
 * const res = await request(app.handle.bind(app)).get('/api/v1/users')
 * ```
 */
/**
 * Normalize every accepted `overrides` shape to `[token, value]` pairs.
 *
 * An array or Map keeps the token's identity, which is what the container
 * matches on; an object literal is limited to string and symbol keys by the
 * language itself.
 */
function overrideEntries(
  overrides: NonNullable<CreateTestAppOptions['overrides']>,
): Array<[unknown, unknown]> {
  if (Array.isArray(overrides)) return overrides.map(([token, value]) => [token, value])
  if (overrides instanceof Map) return [...overrides.entries()]
  const record = overrides as Record<symbol | string, unknown>
  return Reflect.ownKeys(record).map((key) => [key, record[key as never]])
}

export async function createTestApp(options: CreateTestAppOptions): Promise<{
  app: Application
  /**
   * @deprecated Use `app.handle.bind(app)`. Only valid under the Express
   * runtime — under
   * any other engine this throws rather than handing back that engine's
   * instance mistyped as `express.Express`, which is how a suite ends up
   * silently exercising the wrong runtime.
   */
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
    // Default to JSON body parsing only — but NOT on a runtime that parses
    // bodies itself. Passing `express.json()` explicitly bypasses the
    // Application's own native-body guard, and under Fastify the connect
    // parser then consumes the stream before Fastify reads it: a JSON POST
    // hangs until the test times out. `RuntimeCapabilities.nativeBodyParsing`
    // is the same flag the Application guards on.
    middleware:
      options.middleware ??
      (options.runtime?.capabilities.nativeBodyParsing ? [] : [express.json()]),
    onError: options.onError,
    onNotFound: options.onNotFound,
    plugins: options.plugins,
    trustProxy: options.trustProxy,
    jsonLimit: options.jsonLimit,
    security: options.security,
    contributors: options.contributors,
    contextStore: options.contextStore,
    // Without this the option is accepted and ignored, which is worse than
    // not offering it: the suite reports Express while claiming Fastify.
    runtime: options.runtime,
  })

  // Run setup — mounts routes, registers modules, initializes adapters.
  // Awaited to support future async adapter hooks.
  await Promise.resolve(app.setup())

  // When using an isolated container, Application.setup() registers modules
  // on the global singleton (Container.getInstance()). Re-register them on
  // the isolated container so that bindings are available there too.
  if (options.isolated) {
    for (const entry of options.modules) {
      // Discriminate class vs instance — `defineModule` factories return
      // AppModule instances, legacy classes need `new`. Same dispatch
      // Application.setup() runs at boot.
      const mod: AppModule = typeof entry === 'function' ? new (entry as AppModuleClass)() : entry
      // register() is optional — see AppModule docs
      mod.register?.(container)
    }
    container.bootstrap()
  }

  // Apply DI overrides AFTER setup so they take precedence over
  // bindings registered by modules during register().
  if (options.overrides) {
    for (const [token, value] of overrideEntries(options.overrides)) {
      container.registerInstance(token, value)
    }
  }

  const runtimeName = app.getActiveRuntime().name

  return {
    app,
    get expressApp(): express.Express {
      if (runtimeName !== 'express') {
        throw new Error(
          `createTestApp: 'expressApp' is only available under the Express runtime — ` +
            `this app is running '${runtimeName}'. Drive the app instead, which follows ` +
            `whichever engine is configured: request(app.handle.bind(app)).get('/...').`,
        )
      }
      return app.getExpressApp()
    },
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
  K extends ContextMetaKey,
  D extends Record<string, any> = Record<string, never>,
>(
  decorator: ContextDecorator<K, D>,
  options: RunContributorOptions = {},
): Promise<RunContributorResult<K>> {
  const meta = new Map<string, unknown>(Object.entries(options.initial ?? {}))
  const ctx: ExecutionContext = {
    get(key) {
      return meta.get(key) as never
    },
    require(key) {
      // Same contract as RequestContext.require — a resolver under test
      // that depends on an upstream key should fail here exactly the way
      // it would in production, not read `undefined`.
      const value = meta.get(key)
      if (value === undefined) throw new MissingContextValueError(key)
      return value as never
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

// ── Plugin unit-test harness (architecture.md §21.3.2) ──────────────────

/**
 * Options for {@link createTestPlugin}.
 */
export interface CreateTestPluginOptions {
  /**
   * Use an isolated container (default: `true`). Isolated harnesses never
   * touch the global `Container.getInstance()` singleton, so concurrent
   * tests can run without stomping each other's DI state.
   */
  isolated?: boolean

  /**
   * Skip auto-invoking `plugin.register(container)` — useful when a test
   * wants to assert container state *before* the plugin touches it.
   * Defaults to `false` (register is called eagerly).
   */
  skipRegister?: boolean
}

/**
 * Result of {@link createTestPlugin}. Mirrors the spec sketch in
 * `architecture.md` §21.3.2 — `.container`, lifecycle invokers, and a
 * `runContributors()` helper that builds a one-plugin pipeline against a
 * fake `ExecutionContext`.
 */
export interface PluginTestHarness {
  /** The plugin under test — exposed for direct introspection. */
  readonly plugin: KickPlugin
  /** Isolated (or shared) DI container the plugin registered into. */
  readonly container: Container

  /**
   * Invoke `plugin.onReady(container)`. No-op if the plugin does not
   * define the hook.
   */
  callOnReady(): Promise<void>

  /**
   * Invoke `plugin.shutdown()`. No-op if the plugin does not define the
   * hook.
   */
  shutdown(): Promise<void>

  /**
   * Returns the module classes the plugin ships via `plugin.modules?()`.
   * The harness does **not** auto-instantiate them — use `createTestApp`
   * for that. Useful for assertions like "the plugin exposes the module I
   * expect".
   */
  modules(): AppModuleEntry[]

  /**
   * Returns adapter instances the plugin ships via `plugin.adapters?()`.
   * Useful for testing the adapters alongside the plugin's DI bindings.
   */
  adapters(): AppAdapter[]

  /**
   * Returns middleware entries the plugin ships via `plugin.middleware?()`.
   */
  middleware(): any[]

  /**
   * Returns contributor registrations the plugin ships via
   * `plugin.contributors?()`.
   */
  contributors(): ContributorRegistration[]

  /**
   * Build a fake {@link ExecutionContext} pre-populated with the given
   * metadata. Symmetric with {@link runContributor}'s fake context.
   */
  makeContext(initial?: Record<string, unknown>): ExecutionContext

  /**
   * Run every contributor the plugin ships through a built pipeline
   * against the given context. Dependencies resolve through the harness's
   * container (same path production uses). Throws if the plugin's
   * contributors reference `dependsOn` keys no one in the plugin provides.
   */
  runContributors(ctx: ExecutionContext): Promise<void>
}

/**
 * Build an isolated test harness around a single {@link KickPlugin}.
 * Skips the full HTTP layer — symmetric with {@link runContributor} for
 * contributors and {@link createTestApp} for integration runs.
 *
 * @example
 * ```ts
 * const harness = await createTestPlugin(FlagsPlugin({ provider: scripted }))
 *
 * // The plugin's register() already ran — resolve any bindings.
 * const flags = harness.container.resolve(FLAGS_SERVICE)
 *
 * // Drive the post-bootstrap lifecycle.
 * await harness.callOnReady()
 *
 * // Exercise contributors shipped by the plugin.
 * const ctx = harness.makeContext({ requestId: 'req-1' })
 * await harness.runContributors(ctx)
 * expect(ctx.get('flags')).toEqual({ beta: true })
 *
 * await harness.shutdown()
 * ```
 */
export async function createTestPlugin(
  plugin: KickPlugin,
  options: CreateTestPluginOptions = {},
): Promise<PluginTestHarness> {
  const isolated = options.isolated ?? true

  const container = isolated ? Container.create() : (Container.reset(), Container.getInstance())

  if (!options.skipRegister) plugin.register?.(container)

  return {
    plugin,
    container,

    async callOnReady() {
      await plugin.onReady?.(container)
    },

    async shutdown() {
      await plugin.shutdown?.()
    },

    modules() {
      return plugin.modules?.() ?? []
    },

    adapters() {
      return plugin.adapters?.() ?? []
    },

    middleware() {
      return plugin.middleware?.() ?? []
    },

    contributors() {
      return [...(plugin.contributors?.() ?? [])]
    },

    makeContext(initial: Record<string, unknown> = {}) {
      const meta = new Map<string, unknown>(Object.entries(initial))
      const ctx: ExecutionContext = {
        get(key) {
          return meta.get(key) as never
        },
        require(key) {
          const value = meta.get(key)
          if (value === undefined) throw new MissingContextValueError(key)
          return value as never
        },
        set(key, value) {
          meta.set(key, value)
        },
        requestId: 'test-req',
      }
      return ctx
    },

    async runContributors(ctx: ExecutionContext) {
      const regs = plugin.contributors?.() ?? []
      const sources = [...regs].map((registration) => ({
        registration,
        source: 'adapter' as const,
        label: plugin.name,
      }))
      const pipeline = buildPipeline(sources)
      await runContributors({ pipeline, ctx, container })
    },
  }
}

/** Alias for {@link createTestPlugin}, matching the `testPlugin` name used in the architecture spec. */
export const testPlugin = createTestPlugin
