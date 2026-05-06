import type { AppModuleEntry } from './app-module'

/**
 * Chainable registry returned by {@link defineModules}. Extends
 * `Array<AppModuleEntry>` so it drops into `bootstrap({ modules })`
 * unchanged — the framework loader already iterates the array, so a
 * `ModuleList` IS a valid `modules` value with no special handling.
 *
 * The added affordance is `.mount(module)` returning `this` so
 * adopters can build the list fluently:
 *
 * ```ts
 * const modules = defineModules()
 *   .mount(HelloModule())
 *   .mount(AdminModule())
 *
 * bootstrap({ modules })
 * ```
 *
 * **Why not just use a plain array?** Two reasons. First, the
 * fluent shape reads more naturally for module-list construction —
 * adopters used to `definePlugin().scoped(...)` / `defineAdapter(...)`
 * see the same call-then-call pattern. Second, the registry is the
 * stable extension point: a future `.use(module)` for non-HTTP
 * modules (queues, cron, workers) lands as a method on `ModuleList`
 * without breaking the `Array<AppModuleEntry>` superclass contract.
 */
export class ModuleList extends Array<AppModuleEntry> {
  /**
   * Append a module to the list. Returns `this` for chaining.
   *
   * Accepts both class form (`SomeModule extends AppModule`) and
   * `defineModule` factory output — same as the underlying
   * `bootstrap({ modules })` array. The framework loader
   * discriminates `typeof entry === 'function'` at boot.
   */
  mount(module: AppModuleEntry): this {
    this.push(module)
    return this
  }
}

/**
 * Build a {@link ModuleList} for the application. Optional vararg
 * lets adopters seed the list inline; subsequent `.mount()` calls
 * append.
 *
 * @example
 * ```ts
 * import { bootstrap, defineModules } from '@forinda/kickjs'
 * import { HelloModule } from './modules/hello/hello.module'
 * import { AdminModule } from './modules/admin/admin.module'
 *
 * // Fluent — most common
 * const modules = defineModules()
 *   .mount(HelloModule())
 *   .mount(AdminModule())
 *
 * // Or seeded inline + chained
 * const modules2 = defineModules(HelloModule()).mount(AdminModule())
 *
 * await bootstrap({ modules })
 * ```
 *
 * The returned value is an `AppModuleEntry[]` subclass — `bootstrap`
 * accepts it directly without any special-casing. For conditional /
 * dynamic registration at bootstrap time (env flags, runtime config,
 * tenant lists), use the `setup(registry)` callback on `bootstrap`
 * instead — both surfaces compose.
 */
export function defineModules(...initial: AppModuleEntry[]): ModuleList {
  const list = new ModuleList()
  for (const entry of initial) list.push(entry)
  return list
}
