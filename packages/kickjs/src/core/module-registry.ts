import type { AppModuleEntry } from './app-module'

/**
 * Imperative receiver passed to {@link KickPlugin.setup} and the
 * top-level `bootstrap({ setup })` callback so adopters can register
 * modules conditionally — based on env flags, runtime config,
 * tenant lists, etc. — instead of being limited to the static
 * `modules: [...]` array.
 *
 * @example
 * ```ts
 * bootstrap({
 *   modules: [HelloModule()],          // static — always mounted
 *   setup(registry) {
 *     if (env.ENABLE_ADMIN) registry.mount(AdminModule())
 *     for (const tenant of env.TENANTS) {
 *       registry.mount(TenantModule.scoped(tenant.id, { id: tenant.id }))
 *     }
 *   },
 * })
 * ```
 *
 * **Currently exposes only `.mount(module)` — the HTTP-feature path.**
 * A future `.use(module)` for non-HTTP modules (queues, cron, workers,
 * DI-only seeds) is planned but not yet implemented; existing non-HTTP
 * modules continue returning `null` from `routes()` and registering
 * via `.mount()`.
 *
 * Same dispatch rules as the static `modules: [...]` array — class
 * entries get `new`-ed at boot, `defineModule` factory output is used
 * directly. The registry doesn't validate the entry shape itself; the
 * Application loader does the typeof discrimination at mount time.
 */
export interface ModuleRegistry {
  /**
   * Register a module for the full HTTP lifecycle: `register()` runs,
   * `import.meta.glob` decorator side-effects fire, `routes()` is
   * called and its result mounted, `contributors()` are merged at
   * `'module'` precedence and applied to the mounted routes.
   *
   * Modules are mounted in registration order (first call → first
   * mount). Order across sources is: plugin static modules → plugin
   * `setup()` calls → user static modules → user `setup()` callback.
   */
  mount(module: AppModuleEntry): void
}

/**
 * Internal collector implementing {@link ModuleRegistry}. Application
 * passes one of these to every `setup()` callback during bootstrap;
 * the collected `entries` array is then run through the same
 * class-vs-instance dispatch as the static `modules: [...]` array.
 *
 * Not exported from the public surface — adopters interact only
 * through the {@link ModuleRegistry} interface.
 */
export class MutableModuleRegistry implements ModuleRegistry {
  readonly entries: AppModuleEntry[] = []

  mount(module: AppModuleEntry): void {
    this.entries.push(module)
  }
}
