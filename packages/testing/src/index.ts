import express from 'express'
import {
  Container,
  type AppAdapter,
  type AppModule,
  type AppModuleClass,
  type ModuleRoutes,
} from '@forinda/kickjs'
import { Application, type ApplicationOptions } from '@forinda/kickjs'

/**
 * Options for creating a test application.
 * Disables helmet, cors, compression, and morgan by default.
 */
export interface CreateTestAppOptions {
  modules: AppModuleClass[]
  /** Adapters to attach (auth, queue, devtools, etc.) */
  adapters?: AppAdapter[]
  /** DI overrides applied after module registration. Supports both string and symbol keys. */
  overrides?: Record<symbol | string, any>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
  /** Express middleware pipeline. When provided, replaces the default (express.json()). */
  middleware?: express.RequestHandler[]
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
