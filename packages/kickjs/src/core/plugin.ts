import type { Container } from './container'
import type { AppAdapter } from './adapter'
import type { AppModuleClass } from './app-module'
import type { ContributorRegistrations } from './context-decorator'
import type { KickJsPluginName } from './augmentation'

/**
 * Plugin interface for extending KickJS applications.
 *
 * Plugins bundle modules, adapters, middleware, and DI bindings into a single
 * reusable unit. They run before the application bootstraps, so they can
 * register services and configure the app before any module loads.
 *
 * @example
 * ```ts
 * import type { KickPlugin } from '@forinda/kickjs'
 *
 * export class CorsPlugin implements KickPlugin {
 *   name = 'CorsPlugin'
 *
 *   middleware() {
 *     return [cors({ origin: '*' })]
 *   }
 * }
 *
 * // Usage:
 * bootstrap({
 *   modules,
 *   plugins: [new CorsPlugin()],
 * })
 * ```
 *
 * @example
 * ```ts
 * // A more complex plugin that bundles modules and adapters
 * export class AuthPlugin implements KickPlugin {
 *   name = 'AuthPlugin'
 *
 *   constructor(private config: AuthConfig) {}
 *
 *   register(container: Container) {
 *     container.registerFactory(AUTH_SERVICE, () => new JwtAuthService(this.config))
 *   }
 *
 *   modules() {
 *     return [AuthModule]
 *   }
 *
 *   adapters() {
 *     return [new AuthGuardAdapter(this.config)]
 *   }
 *
 *   middleware() {
 *     return [passport.initialize()]
 *   }
 * }
 * ```
 */
export interface KickPlugin {
  /** Human-readable name for logging, debugging, and `dependsOn` resolution. */
  name: string

  /**
   * Other plugin names that must mount before this one. The framework
   * topologically sorts plugins at boot — cycles or unknown names throw
   * via {@link MountCycleError} / {@link MissingMountDepError} so bad
   * configurations fail boot rather than corrupt live traffic.
   *
   * Plugins with no `dependsOn` retain their declaration order, so
   * existing apps that don't use this field see no behaviour change.
   *
   * @example
   * ```ts
   * class MonitoringPlugin implements KickPlugin {
   *   name = 'MonitoringPlugin'
   *   // OTel must initialize traces before request logger reads them
   *   dependsOn = ['OtelPlugin']
   * }
   * ```
   */
  dependsOn?: readonly KickJsPluginName[]

  /**
   * Register DI bindings before modules load.
   * Use this to provide services that modules depend on.
   */
  register?(container: Container): void

  /**
   * Return module classes to be loaded alongside user modules.
   * Plugin modules are loaded before user modules.
   */
  modules?(): AppModuleClass[]

  /**
   * Return adapter instances to be added to the application.
   * Plugin adapters are added before user adapters.
   */
  adapters?(): AppAdapter[]

  /**
   * Return Express middleware to be added to the global pipeline.
   * Plugin middleware runs before user-defined middleware.
   */
  middleware?(): any[]

  /**
   * Return Context Contributors (#107) the plugin ships. Contributors
   * returned here merge into the per-route pipeline at the **`'adapter'`
   * precedence level** — same as those returned by adapters the plugin
   * ships via {@link KickPlugin.adapters}, and for the same reason: a
   * plugin is a cross-cutting bundle, narrower than the global default
   * but broader than a per-module hook.
   *
   * Use when a plugin wants to ship a typed contributor without standing
   * up an accompanying adapter. For full coverage of the precedence
   * matrix (method > class > module > adapter > global) see
   * `docs/guide/context-decorators.md`.
   *
   * @example
   * ```ts
   * import { defineContextDecorator, type KickPlugin } from '@forinda/kickjs'
   *
   * const LoadFlags = defineContextDecorator({
   *   key: 'flags',
   *   resolve: (ctx) => fetchFlags(ctx.requestId!),
   * })
   *
   * export class FlagsPlugin implements KickPlugin {
   *   name = 'FlagsPlugin'
   *   contributors() {
   *     return [LoadFlags.registration]
   *   }
   * }
   * ```
   */
  contributors?(): ContributorRegistrations

  /**
   * Called after the application has fully bootstrapped.
   * Use for post-startup logic like logging, health registration, etc.
   */
  onReady?(container: Container): void | Promise<void>

  /**
   * Called during application shutdown.
   * Clean up plugin resources (connections, intervals, etc.).
   */
  shutdown?(): void | Promise<void>

  /**
   * Optional DevTools introspection hook (architecture.md §23). Returns
   * a snapshot describing this plugin's current state, metrics, and DI
   * tokens. DevTools awaits the result, so async work is fine — but keep
   * the implementation cheap (counters + flags, no DB round trips) since
   * the topology endpoint polls on a short interval.
   *
   * The return type is intentionally untyped at this layer to avoid
   * `@forinda/kickjs` taking on a runtime dep on `@forinda/kickjs-devtools-kit`.
   * Plugin authors should import and return `IntrospectionSnapshot`
   * from `@forinda/kickjs-devtools-kit` directly.
   */
  introspect?(): unknown | Promise<unknown>

  /**
   * Optional DevTools tabs this plugin contributes (architecture.md §23).
   * Same shape as {@link AppAdapter.devtoolsTabs}; the kit's
   * `DevtoolsTabDescriptor` types it for plugin authors.
   */
  devtoolsTabs?(): readonly unknown[]
}
