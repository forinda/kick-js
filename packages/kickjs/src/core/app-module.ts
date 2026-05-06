import type { Container } from './container'
import type { ContributorRegistrations } from './context-decorator'

/**
 * Route set returned by a module's routes() method.
 * Combined with versioning: /{apiPrefix}/v{version}{path}
 *
 * **Either** `controller` or `router` is required. Pass `controller`
 * for the common case — the framework calls `buildRoutes(controller)`
 * internally to derive the Express Router. Pass `router` directly
 * only when you need to compose multiple controllers under one path
 * or hand-build the router yourself.
 */
export interface ModuleRoutes {
  /** URL prefix (e.g. '/users') */
  path: string
  /**
   * Express Router instance. Optional — when omitted, the framework
   * builds one from `controller` via `buildRoutes(controller)`. Pass
   * an explicit router only when you need to compose multiple
   * controllers or hand-roll the router shape.
   */
  router?: any
  /** Optional API version override (defaults to Application.defaultVersion) */
  version?: number
  /**
   * Controller class. Required unless `router` is provided. Used both
   * for the auto-derived router (via `buildRoutes(controller)`) and
   * for OpenAPI spec generation via `SwaggerAdapter`.
   */
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
  contributors?(): ContributorRegistrations
  /** Return route definitions for this module, or null for non-HTTP modules */
  routes(): ModuleRoutes | ModuleRoutes[] | null
}

/**
 * Constructor type for the legacy `class FooModule implements AppModule`
 * pattern. The framework still accepts these — bootstrap discriminates
 * class vs instance at boot — but new code should prefer
 * {@link defineModule} for parity with {@link defineAdapter} and
 * {@link definePlugin}, plus typed config + `.scoped()` / `.definition`.
 *
 * @deprecated Use `defineModule({ ... })` and `AppModuleEntry` for the
 *   `bootstrap({ modules })` array. The class form continues to work
 *   through v5 and is not slated for removal in any specific release —
 *   this annotation is a soft "prefer the factory form" hint, not an
 *   imminent deprecation.
 */
export type AppModuleClass = new () => AppModule

/**
 * Either form accepted by `bootstrap({ modules })` and
 * `KickPlugin.modules?()`:
 *
 *   - **Class** — the legacy form. Bootstrap calls `new ModuleClass()`.
 *   - **Instance** — produced by {@link defineModule}'s factory call
 *     (e.g. `TasksModule({ scope: 'admin' })`). Bootstrap uses it
 *     directly without `new`.
 *
 * Both shapes route through the same lifecycle (`register`,
 * `contributors`, `routes`) — the only difference is who owns
 * instantiation. defineModule callers use this union so adopters can
 * mix-and-match in the same `modules` array.
 */
export type AppModuleEntry = AppModuleClass | AppModule
