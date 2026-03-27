import type { Container } from './container'
/**
 * Route set returned by a module's routes() method.
 * Combined with versioning: /{apiPrefix}/v{version}{path}
 */
export interface ModuleRoutes {
  /** URL prefix (e.g. '/users') */
  path: string
  /** Express Router instance (from buildRoutes) */
  router: any
  /** Optional API version override (defaults to Application.defaultVersion) */
  version?: number
  /** Controller class for OpenAPI introspection */
  controller?: any
}
/**
 * Interface that every feature module must implement.
 * Modules register their DI bindings and declare their routes.
 */
export interface AppModule {
  /** Bind interfaces to implementations in the container */
  register(container: Container): void
  /** Return route definitions for this module, or null for non-HTTP modules */
  routes(): ModuleRoutes | ModuleRoutes[] | null
}
/** Constructor type for AppModule classes */
export type AppModuleClass = new () => AppModule
//# sourceMappingURL=app-module.d.ts.map
