import type { Container } from './container'
import type { ContributorRegistration } from './context-decorator'

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
 *
 * `register` is **optional**. Modules that only contain decorated classes
 * (`@Service`, `@Controller`, `@Repository`, `@Component`) don't need it
 * because the decorators handle DI registration automatically. Implement
 * `register(container)` only when you need to bind a token (typically a
 * repository interface symbol) to a concrete implementation via
 * `container.registerFactory()` / `container.registerInstance()`.
 */
export interface AppModule {
  /** Optional — bind interfaces to implementations in the container */
  register?(container: Container): void
  /**
   * Return Context Contributors (#107) that apply to every route this
   * module mounts. Module-level contributors are merged into the per-route
   * pipeline at the `'module'` precedence level — they win over adapter
   * and global contributors but lose to method and class decorators.
   *
   * Optional — modules without per-module contributors omit this hook.
   */
  contributors?(): ContributorRegistration[] | readonly ContributorRegistration[]
  /** Return route definitions for this module, or null for non-HTTP modules */
  routes(): ModuleRoutes | ModuleRoutes[] | null
}

/** Constructor type for AppModule classes */
export type AppModuleClass = new () => AppModule
