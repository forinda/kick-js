import type { AppModule } from './app-module'
import type { BuildContext } from './define-plugin'

/**
 * Options passed to {@link defineModule}. Mirrors {@link DefineAdapterOptions}
 * and {@link DefinePluginOptions} so adopters learn one mental model
 * across all three primitives.
 *
 * The optional `TExtra` generic lets a module ship public methods
 * beyond the standard {@link AppModule} contract — they're preserved
 * on the returned module instance so external callers (tests, sibling
 * modules) can invoke them directly.
 */
export interface DefineModuleOptions<TConfig, TExtra = unknown> {
  /**
   * Stable identity surfaced in diagnostics, route logs, and
   * `.scoped()` namespacing. Required because boot-time error
   * messages reference modules by name — anonymous modules make
   * cycles + missing-dep errors hard to localize.
   */
  name: string
  /** Optional version string surfaced in diagnostics. */
  version?: string
  /**
   * Optional kickjs version constraint. Enforced by the framework
   * when implemented; today it lives on the definition for
   * documentation and forward compatibility.
   */
  requires?: { kickjs?: string }
  /**
   * Default config merged with overrides at instantiation time
   * (`MyModule({ field: x })`). Call-site overrides win.
   */
  defaults?: Partial<TConfig>
  /**
   * Build the AppModule shape from the resolved config and context.
   * `ctx.name` is the resolved instance name (the bare definition
   * name for the default call, or `${name}:${scope}` for
   * `.scoped()`); `ctx.scoped` discriminates so the build function
   * can branch on namespacing if needed.
   *
   * Return any extension methods alongside the standard
   * {@link AppModule} surface — they're typed via `TExtra` and stay
   * accessible on the resulting instance.
   */
  build(config: TConfig, ctx: BuildContext): AppModule & TExtra
}

/**
 * Factory returned by {@link defineModule}. Mirrors {@link AdapterFactory}
 * — call (`MyModule({...})`), scope (`MyModule.scoped('public', {...})`),
 * inspect (`MyModule.definition`).
 *
 * `.async()` is intentionally **not** part of the module factory
 * surface. Module config has no async-resolution window: `register()`
 * and `routes()` both run synchronously during bootstrap, before any
 * adapter `beforeStart` hook fires. Adopters that need async-resolved
 * config push it into an adapter (which has `beforeStart`), then
 * inject the resolved value into the module via DI tokens.
 */
export interface ModuleFactory<TConfig, TExtra = unknown> {
  (config?: Partial<TConfig>): AppModule & TExtra
  scoped(scopeName: string, config?: Partial<TConfig>): AppModule & TExtra
  readonly definition: Readonly<DefineModuleOptions<TConfig, TExtra>>
}

const mergeConfig = <TConfig>(
  defaults: Partial<TConfig> = {},
  overrides: Partial<TConfig> = {},
): TConfig => ({ ...defaults, ...overrides }) as TConfig

const composeName = (base: string, scope: string): string => `${base}:${scope}`

/**
 * Build an {@link AppModule} factory from a typed definition. Pairs
 * with {@link defineAdapter}, {@link definePlugin}, and
 * {@link defineContextDecorator} as the fourth `define*` primitive
 * — adopters write modules the same way they write adapters and
 * plugins.
 *
 * The returned factory produces real {@link AppModule} instances
 * that drop into `bootstrap({ modules })` directly. The legacy
 * class form (`class TasksModule implements AppModule { ... }`) keeps
 * working — `bootstrap` accepts either shape.
 *
 * @example
 * ```ts
 * interface TasksConfig {
 *   scope: 'public' | 'admin'
 * }
 *
 * const TasksModule = defineModule<TasksConfig>({
 *   name: 'TasksModule',
 *   defaults: { scope: 'public' },
 *   build: (config, { name }) => ({
 *     register(container) {
 *       container.registerInstance(`tasks:scope:${name}`, config.scope)
 *     },
 *     routes() {
 *       return { path: `/${config.scope}/tasks`, router: buildTasksRouter() }
 *     },
 *     contributors() {
 *       return [LoadTenant.registration]
 *     },
 *   }),
 * })
 *
 * bootstrap({
 *   modules: [
 *     TasksModule(),                              // public scope (defaults)
 *     TasksModule.scoped('admin', { scope: 'admin' }),
 *   ],
 * })
 * ```
 */
export function defineModule<TConfig = Record<string, unknown>, TExtra = unknown>(
  options: DefineModuleOptions<TConfig, TExtra>,
): ModuleFactory<TConfig, TExtra> {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(
      'defineModule: options must be an object literal. ' +
        'See architecture.md §21 for the spec shape.',
    )
  }
  if (typeof options.name !== 'string' || options.name.length === 0) {
    const got = typeof options.name === 'string' ? '""' : typeof options.name
    throw new TypeError(
      `defineModule: options.name must be a non-empty string (got ${got}). ` +
        'Module names appear in diagnostics and `.scoped()` namespacing — anonymous ' +
        'modules make cycle / missing-dep errors hard to localize.',
    )
  }
  if (typeof options.build !== 'function') {
    throw new TypeError(
      `defineModule(${options.name}): options.build is required and must be a function ` +
        `(got ${typeof options.build}). The build function returns the AppModule shape — ` +
        'register() / routes() / contributors() — wired with the resolved config.',
    )
  }

  const buildSync = (
    instanceName: string,
    scoped: boolean,
    overrides?: Partial<TConfig>,
  ): AppModule & TExtra => {
    const config = mergeConfig(options.defaults, overrides)
    // Mutate-in-place rather than spread: spread strips prototype methods
    // when build() returns a class instance, and the existing defineAdapter
    // pattern uses the same approach. `TExtra` properties survive because
    // they're own properties on the build result.
    const built = options.build(config, { name: instanceName, scoped })
    // AppModule has no `name` field today, but stamping the resolved
    // instance name onto the result lets diagnostics surface it without
    // adopter wiring. The cast keeps the public AppModule type
    // unchanged while the data is available for any framework code
    // that wants it.
    Object.defineProperty(built, '__moduleName', {
      value: instanceName,
      enumerable: false,
      writable: false,
      configurable: false,
    })
    return built
  }

  const factory = ((config?: Partial<TConfig>) =>
    buildSync(options.name, false, config)) as ModuleFactory<TConfig, TExtra>

  factory.scoped = (scopeName: string, config?: Partial<TConfig>) =>
    buildSync(composeName(options.name, scopeName), true, config)

  Object.defineProperty(factory, 'definition', {
    value: Object.freeze({ ...options }),
    writable: false,
    enumerable: true,
    configurable: false,
  })

  return factory
}
