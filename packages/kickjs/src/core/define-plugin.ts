import type { Container } from './container'
import type { KickPlugin } from './plugin'

/**
 * Options passed to {@link definePlugin}. Mirrors the spec in
 * `architecture.md` §21.3.1 + §21.2.2 (Phase A "lite").
 */
export interface DefinePluginOptions<TConfig> {
  /** Stable identity used for logging, `dependsOn` lookups, and `.scoped()` namespacing. */
  name: string

  /** Optional plugin version — surfaced to DevTools and `kick add` compatibility checks (Phase B). */
  version?: string

  /**
   * Peer-version ranges this plugin needs from the framework or other
   * plugins. Recorded as metadata; runtime enforcement lands in §21.4.4.
   */
  requires?: { kickjs?: string }

  /** Default config merged under any caller overrides. */
  defaults?: Partial<TConfig>

  /** Builds the underlying {@link KickPlugin} from the resolved config. */
  build(config: TConfig, ctx: BuildContext): Omit<KickPlugin, 'name'>
}

/**
 * Hook context handed to a plugin/adapter `build` function. `name` is the
 * resolved instance name (the bare definition name for the bare call,
 * or `${defName}:${scope}` for `.scoped()`). `scoped` is the discriminator
 * authors use to namespace DI tokens or resource keys.
 */
export interface BuildContext {
  name: string
  scoped: boolean
}

/**
 * Async-config form of a plugin or adapter — `inject` lists DI tokens to
 * resolve from the container, then `useFactory` produces the config.
 *
 * Plugins resolve this lazily inside `onReady`, so any module/adapter/
 * middleware/contributor a plugin contributes via `build` is **not
 * available** when `.async()` is used. Use the bare/`.scoped()` form for
 * plugins that need to register modules or middleware.
 */
export interface PluginAsyncOptions<TConfig> {
  inject?: ReadonlyArray<unknown>
  useFactory(...deps: any[]): TConfig | Promise<TConfig>
}

/**
 * Factory returned by {@link definePlugin}. Callable form is the singleton
 * (`AuthPlugin(config)`); `.scoped()` and `.async()` are the multi-instance
 * and deferred-config forms.
 */
export interface PluginFactory<TConfig> {
  (config?: Partial<TConfig>): KickPlugin
  scoped(scopeName: string, config?: Partial<TConfig>): KickPlugin
  async(opts: PluginAsyncOptions<TConfig>): KickPlugin
  /** Read-only access to the original definition — useful for DevTools introspection. */
  readonly definition: Readonly<DefinePluginOptions<TConfig>>
}

const mergeConfig = <TConfig>(
  defaults: Partial<TConfig> | undefined,
  overrides: Partial<TConfig> | undefined,
): TConfig => ({ ...(defaults ?? {}), ...(overrides ?? {}) }) as TConfig

const composeName = (base: string, scope: string): string => `${base}:${scope}`

/**
 * Build a {@link KickPlugin} factory from a typed definition. See
 * `architecture.md` §21.2.2 for the design rationale.
 *
 * @example
 * ```ts
 * const FlagsPlugin = definePlugin<FlagsConfig>({
 *   name: 'FlagsPlugin',
 *   defaults: { defaultTtl: 60_000 },
 *   build(config) {
 *     return {
 *       register(container) {
 *         container.registerInstance(FLAGS, makeProvider(config))
 *       },
 *     }
 *   },
 * })
 *
 * bootstrap({ plugins: [FlagsPlugin({ provider: launchDarkly })] })
 * ```
 */
export function definePlugin<TConfig = Record<string, unknown>>(
  options: DefinePluginOptions<TConfig>,
): PluginFactory<TConfig> {
  const buildSync = (
    instanceName: string,
    scoped: boolean,
    overrides?: Partial<TConfig>,
  ): KickPlugin => {
    const config = mergeConfig(options.defaults, overrides)
    const built = options.build(config, { name: instanceName, scoped })
    return { ...built, name: instanceName }
  }

  const buildAsync = (instanceName: string, opts: PluginAsyncOptions<TConfig>): KickPlugin => {
    let inner: KickPlugin | undefined

    const ensureInner = async (container: Container): Promise<KickPlugin> => {
      if (inner) return inner
      const deps = (opts.inject ?? []).map((tok) => container.resolve(tok as never))
      const config = await opts.useFactory(...deps)
      inner = buildSync(instanceName, false, config as Partial<TConfig>)
      return inner
    }

    return {
      name: instanceName,
      async onReady(container: Container) {
        const built = await ensureInner(container)
        // Run the inner plugin's register() now that we have the config —
        // late but better than never; `.async()` plugins skip the early
        // module/middleware contribution surface by design.
        built.register?.(container)
        await built.onReady?.(container)
      },
      async shutdown() {
        await inner?.shutdown?.()
      },
    }
  }

  const factory = ((config?: Partial<TConfig>) =>
    buildSync(options.name, false, config)) as PluginFactory<TConfig>

  factory.scoped = (scopeName: string, config?: Partial<TConfig>) =>
    buildSync(composeName(options.name, scopeName), true, config)

  factory.async = (opts: PluginAsyncOptions<TConfig>) => buildAsync(options.name, opts)

  Object.defineProperty(factory, 'definition', { value: Object.freeze({ ...options }) })

  return factory
}
