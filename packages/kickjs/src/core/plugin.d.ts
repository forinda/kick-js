import type { Container } from './container'
import type { AppAdapter } from './adapter'
import type { AppModuleClass } from './app-module'
/**
 * Plugin interface for extending KickJS applications.
 *
 * Plugins bundle modules, adapters, middleware, and DI bindings into a single
 * reusable unit. They run before the application bootstraps, so they can
 * register services and configure the app before any module loads.
 *
 * @example
 * ```ts
 * import type { KickPlugin } from '@forinda/kickjs-core'
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
  /** Human-readable name for logging and debugging */
  name: string
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
   * Called after the application has fully bootstrapped.
   * Use for post-startup logic like logging, health registration, etc.
   */
  onReady?(container: Container): void | Promise<void>
  /**
   * Called during application shutdown.
   * Clean up plugin resources (connections, intervals, etc.).
   */
  shutdown?(): void | Promise<void>
}
//# sourceMappingURL=plugin.d.ts.map
