import express from 'express'
import {
  Container,
  type AppAdapter,
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
  /** Adapters to attach (auth, queue, devtools, etc.) */
  adapters?: AppAdapter[]
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
    adapters: options.adapters,
    port: options.port,
    apiPrefix: options.apiPrefix,
    defaultVersion: options.defaultVersion,
    // Minimal middleware for testing — JSON body parsing only, no helmet/cors/compression
    middleware: [express.json()],
  })

  // Run setup — this calls module register() and mounts routes
  app.setup()

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
 */
export function createTestModule(config: {
  register: (container: Container) => void
  routes: () => ModuleRoutes | ModuleRoutes[] | null
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
