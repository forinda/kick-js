import {
  Container,
  type AppModule,
  type AppModuleClass,
  type ModuleRoutes,
} from '@forinda/kickjs-core'
import { Application, type ApplicationOptions } from '@forinda/kickjs-http'

/**
 * Options for creating a test application.
 * Disables helmet, cors, compression, and morgan by default.
 */
export interface CreateTestAppOptions {
  modules: AppModuleClass[]
  overrides?: Record<symbol | string, any>
  port?: number
  apiPrefix?: string
  defaultVersion?: number
}

/**
 * Create an Application instance configured for testing.
 * Resets the DI container, registers modules, applies overrides,
 * and returns both the Application and its Express app.
 */
export function createTestApp(options: CreateTestAppOptions): {
  app: Application
  expressApp: any
  container: Container
} {
  Container.reset()
  const container = Container.getInstance()

  const app = new Application({
    modules: options.modules,
    port: options.port,
    apiPrefix: options.apiPrefix,
    defaultVersion: options.defaultVersion,
    // Use minimal middleware for testing — no helmet, cors, compression, etc.
    middleware: [],
  })

  // Apply DI overrides (e.g. mock repositories)
  // Use Reflect.ownKeys to iterate both string and symbol keys
  if (options.overrides) {
    for (const token of Reflect.ownKeys(options.overrides)) {
      container.registerInstance(token, options.overrides[token as any])
    }
  }

  // Run setup without starting the HTTP server
  app.setup()

  return {
    app,
    expressApp: app.getExpressApp(),
    container,
  }
}

/**
 * Build a quick TestModule that explicitly registers dependencies.
 * Useful for integration tests that need to control the DI graph.
 */
export function createTestModule(config: {
  register: (container: Container) => void
  routes: () => ModuleRoutes | ModuleRoutes[]
}): AppModuleClass {
  return class TestModule implements AppModule {
    register(container: Container) {
      config.register(container)
    }
    routes() {
      return config.routes()
    }
  } as AppModuleClass
}
