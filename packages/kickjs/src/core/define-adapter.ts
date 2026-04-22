import type { AppAdapter, AdapterContext } from './adapter'
import type { BuildContext } from './define-plugin'

/**
 * Options passed to {@link defineAdapter}. Mirrors {@link DefinePluginOptions}
 * exactly — see `architecture.md` §21.3.4 for the definePlugin/defineAdapter
 * symmetry rationale.
 *
 * The optional `TExtra` generic lets an adapter ship public methods
 * beyond the standard {@link AppAdapter} contract — they're preserved
 * on the returned adapter instance so external callers (tests, peer
 * adapters) can invoke them directly. See `OtelAdapter.applyRedaction`
 * for the canonical use case.
 */
export interface DefineAdapterOptions<TConfig, TExtra = unknown> {
  /**
   * Stable identity used for logging, `dependsOn` lookups, and `.scoped()`
   * namespacing. Required for adapters that participate in `dependsOn`
   * sort — error messages reference adapters by name.
   */
  name: string
  version?: string
  requires?: { kickjs?: string }
  defaults?: Partial<TConfig>
  build(config: TConfig, ctx: BuildContext): Omit<AppAdapter, 'name'> & TExtra
}

/**
 * Async-config form of an adapter. Identical shape to `PluginAsyncOptions`
 * but resolved during `beforeStart` (the earliest async hook in
 * `AppAdapter`) — meaning `middleware()` and `contributors()` from the inner
 * adapter are **not** picked up. Use the bare/`.scoped()` form when you need
 * those.
 */
export interface AdapterAsyncOptions<TConfig> {
  inject?: ReadonlyArray<unknown>
  useFactory(...deps: any[]): TConfig | Promise<TConfig>
}

/**
 * Factory returned by {@link defineAdapter}. Same surface as
 * {@link PluginFactory} (call / `.scoped()` / `.async()`) so adopters learn
 * one mental model for both primitives. Returned instances carry both
 * the standard {@link AppAdapter} contract and any `TExtra` extension
 * methods the `build` function exposed.
 */
export interface AdapterFactory<TConfig, TExtra = unknown> {
  (config?: Partial<TConfig>): AppAdapter & TExtra
  scoped(scopeName: string, config?: Partial<TConfig>): AppAdapter & TExtra
  async(opts: AdapterAsyncOptions<TConfig>): AppAdapter
  readonly definition: Readonly<DefineAdapterOptions<TConfig, TExtra>>
}

const mergeConfig = <TConfig>(
  defaults: Partial<TConfig> | undefined,
  overrides: Partial<TConfig> | undefined,
): TConfig => ({ ...(defaults ?? {}), ...(overrides ?? {}) }) as TConfig

const composeName = (base: string, scope: string): string => `${base}:${scope}`

/**
 * Build an {@link AppAdapter} factory from a typed definition. See
 * `architecture.md` §21.3.4 for migration guidance — most first-party
 * adapter packages collapse to a single `defineAdapter()` call after this
 * lands.
 *
 * @example
 * ```ts
 * const TenantAdapter = defineAdapter<TenantConfig>({
 *   name: 'TenantAdapter',
 *   defaults: { strategy: 'header', required: true },
 *   build: (config) => ({
 *     middleware: () => [tenantResolverMiddleware(config)],
 *     beforeStart: ({ container }) => registerTenantFactory(container, config),
 *   }),
 * })
 *
 * bootstrap({
 *   adapters: [
 *     TenantAdapter({ strategy: 'subdomain' }),
 *     TenantAdapter.scoped('shard-eu', { headerName: 'x-eu-tenant' }),
 *   ],
 * })
 * ```
 */
export function defineAdapter<TConfig = Record<string, unknown>, TExtra = unknown>(
  options: DefineAdapterOptions<TConfig, TExtra>,
): AdapterFactory<TConfig, TExtra> {
  const buildSync = (
    instanceName: string,
    scoped: boolean,
    overrides?: Partial<TConfig>,
  ): AppAdapter & TExtra => {
    const config = mergeConfig(options.defaults, overrides)
    // Mutate `name` on the build result instead of spreading — spread
    // strips prototype methods when `build()` returns a class instance.
    // Extension methods declared by the build function (`TExtra`) survive
    // the mutation since they're own properties on the build result.
    const built = options.build(config, { name: instanceName, scoped }) as AppAdapter & TExtra
    ;(built as AppAdapter).name = instanceName
    return built
  }

  const buildAsync = (instanceName: string, opts: AdapterAsyncOptions<TConfig>): AppAdapter => {
    let inner: AppAdapter | undefined

    return {
      name: instanceName,
      async beforeStart(ctx: AdapterContext) {
        const deps = (opts.inject ?? []).map((tok) => ctx.container.resolve(tok as never))
        const config = await opts.useFactory(...deps)
        inner = buildSync(instanceName, false, config as Partial<TConfig>)
        await inner.beforeStart?.(ctx)
      },
      async afterStart(ctx: AdapterContext) {
        await inner?.afterStart?.(ctx)
      },
      async shutdown() {
        await inner?.shutdown?.()
      },
      async onHealthCheck() {
        return (await inner?.onHealthCheck?.()) ?? { name: instanceName, status: 'up' }
      },
    }
  }

  const factory = ((config?: Partial<TConfig>) =>
    buildSync(options.name, false, config)) as AdapterFactory<TConfig, TExtra>

  factory.scoped = (scopeName: string, config?: Partial<TConfig>) =>
    buildSync(composeName(options.name, scopeName), true, config)

  factory.async = (opts: AdapterAsyncOptions<TConfig>) => buildAsync(options.name, opts)

  Object.defineProperty(factory, 'definition', { value: Object.freeze({ ...options }) })

  return factory
}
