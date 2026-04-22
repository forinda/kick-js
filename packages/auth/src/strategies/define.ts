import type { AuthStrategy } from '../types'

/**
 * Options passed to {@link createAuthStrategy}. Mirrors the
 * `defineAdapter` / `definePlugin` shape from the framework so adopters
 * learn one mental model for both adapter and strategy authoring.
 */
export interface CreateAuthStrategyOptions<TOptions> {
  /**
   * Stable identity used for logging and `.scoped()` namespacing.
   * Conventionally lowercase (`'jwt'`, `'api-key'`, `'session'`) so the
   * name flows directly into `AuthAdapter.strategies` matching.
   */
  name: string

  /** Default options merged under any caller overrides. */
  defaults?: Partial<TOptions>

  /**
   * Builds the underlying {@link AuthStrategy.validate} function from the
   * resolved options. The returned object's `validate` is wired into an
   * AuthStrategy instance with the resolved name.
   */
  build(options: TOptions, ctx: StrategyBuildContext): Pick<AuthStrategy, 'validate'>
}

/**
 * Hook context handed to a strategy `build` function. Symmetric with
 * {@link BuildContext} from `@forinda/kickjs` — `name` is the resolved
 * instance name (the bare definition name for the bare call, or
 * `${defName}:${scope}` for `.scoped()`); `scoped` discriminates the two.
 */
export interface StrategyBuildContext {
  name: string
  scoped: boolean
}

/**
 * Factory returned by {@link createAuthStrategy}. Callable form is the
 * singleton strategy instance; `.scoped()` is the namespaced
 * multi-instance form for cases like multiple JWT realms or per-tenant
 * API key tables.
 */
export interface AuthStrategyFactory<TOptions> {
  (options?: Partial<TOptions>): AuthStrategy
  scoped(scopeName: string, options?: Partial<TOptions>): AuthStrategy
  /** Read-only access to the original definition — useful for tooling. */
  readonly definition: Readonly<CreateAuthStrategyOptions<TOptions>>
}

const mergeOptions = <TOptions>(
  defaults: Partial<TOptions> | undefined,
  overrides: Partial<TOptions> | undefined,
): TOptions => ({ ...(defaults ?? {}), ...(overrides ?? {}) }) as TOptions

const composeName = (base: string, scope: string): string => `${base}:${scope}`

/**
 * Build an {@link AuthStrategy} factory from a typed definition. Strategies
 * built this way get the same call/`.scoped()` ergonomics as adapters
 * built with `defineAdapter` — no `new` keyword, namespaced multi-instance
 * for shared per-realm configurations.
 *
 * @example
 * ```ts
 * import { createAuthStrategy } from '@forinda/kickjs-auth'
 *
 * interface ApiKeyOptions {
 *   keys: Record<string, { name: string; roles?: string[] }>
 *   headerName?: string
 * }
 *
 * export const ApiKeyStrategy = createAuthStrategy<ApiKeyOptions>({
 *   name: 'api-key',
 *   defaults: { headerName: 'x-api-key' },
 *   build: (options) => ({
 *     validate: (req) => {
 *       const key = req.headers?.[options.headerName!]
 *       return options.keys[key] ?? null
 *     },
 *   }),
 * })
 *
 * // Singleton:
 * adapters: [
 *   AuthAdapter({
 *     strategies: [ApiKeyStrategy({ keys: { 'sk-1': { name: 'CI' } } })],
 *   }),
 * ]
 *
 * // Multiple realms / shards:
 * adapters: [
 *   AuthAdapter({
 *     strategies: [
 *       ApiKeyStrategy.scoped('admin', { keys: adminKeys, headerName: 'x-admin-key' }),
 *       ApiKeyStrategy.scoped('public', { keys: publicKeys }),
 *     ],
 *   }),
 * ]
 * ```
 */
export function createAuthStrategy<TOptions = Record<string, unknown>>(
  options: CreateAuthStrategyOptions<TOptions>,
): AuthStrategyFactory<TOptions> {
  const buildSync = (
    instanceName: string,
    scoped: boolean,
    overrides?: Partial<TOptions>,
  ): AuthStrategy => {
    const merged = mergeOptions(options.defaults, overrides)
    const built = options.build(merged, { name: instanceName, scoped })
    return { name: instanceName, validate: built.validate }
  }

  const factory = ((overrides?: Partial<TOptions>) =>
    buildSync(options.name, false, overrides)) as AuthStrategyFactory<TOptions>

  factory.scoped = (scopeName: string, overrides?: Partial<TOptions>) =>
    buildSync(composeName(options.name, scopeName), true, overrides)

  Object.defineProperty(factory, 'definition', { value: Object.freeze({ ...options }) })

  return factory
}
