import type { AuthStrategy } from '../types'

/**
 * Options passed to {@link createAuthStrategy}. Mirrors the
 * `defineAdapter` / `definePlugin` shape from the framework so adopters
 * learn one mental model for both adapter and strategy authoring.
 *
 * The optional `TExtra` generic lets a strategy ship public methods
 * beyond `validate` (e.g. OAuth's `getAuthorizationUrl`) — they're
 * preserved on the returned strategy instance so callers can invoke
 * them directly.
 */
export interface CreateAuthStrategyOptions<TOptions, TExtra = unknown> {
  /**
   * Stable identity used for logging and `.scoped()` namespacing.
   *
   * Conventionally a lowercase string (`'jwt'`, `'api-key'`, `'session'`).
   * Pass a function instead when the name depends on the resolved
   * options — e.g. OAuth derives `'oauth-google'` from `options.provider`.
   */
  name: string | ((options: TOptions) => string)

  /** Default options merged under any caller overrides. */
  defaults?: Partial<TOptions>

  /**
   * Builds the underlying {@link AuthStrategy.validate} function from the
   * resolved options. May return additional public methods (`TExtra`)
   * that get spread onto the resulting strategy instance — see OAuth's
   * `getAuthorizationUrl()` for the canonical use case.
   */
  build(options: TOptions, ctx: StrategyBuildContext): Pick<AuthStrategy, 'validate'> & TExtra
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
 * API key tables. Returned instances carry both the standard
 * {@link AuthStrategy} contract and any `TExtra` public methods the
 * `build` function exposed.
 */
export interface AuthStrategyFactory<TOptions, TExtra = unknown> {
  (options?: Partial<TOptions>): AuthStrategy & TExtra
  scoped(scopeName: string, options?: Partial<TOptions>): AuthStrategy & TExtra
  /** Read-only access to the original definition — useful for tooling. */
  readonly definition: Readonly<CreateAuthStrategyOptions<TOptions, TExtra>>
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
export function createAuthStrategy<TOptions = Record<string, unknown>, TExtra = unknown>(
  options: CreateAuthStrategyOptions<TOptions, TExtra>,
): AuthStrategyFactory<TOptions, TExtra> {
  const resolveBaseName = (merged: TOptions): string =>
    typeof options.name === 'function' ? options.name(merged) : options.name

  const buildSync = (
    scopeName: string | null,
    overrides?: Partial<TOptions>,
  ): AuthStrategy & TExtra => {
    const merged = mergeOptions(options.defaults, overrides)
    const baseName = resolveBaseName(merged)
    const instanceName = scopeName === null ? baseName : composeName(baseName, scopeName)
    const built = options.build(merged, { name: instanceName, scoped: scopeName !== null })
    // Spread `built` to preserve any extension methods the strategy ships
    // (e.g. OAuth's getAuthorizationUrl), then overwrite `name` and
    // `validate` with the canonical values from this factory call.
    return { ...built, name: instanceName, validate: built.validate } as AuthStrategy & TExtra
  }

  const factory = ((overrides?: Partial<TOptions>) =>
    buildSync(null, overrides)) as AuthStrategyFactory<TOptions, TExtra>

  factory.scoped = (scopeName: string, overrides?: Partial<TOptions>) =>
    buildSync(scopeName, overrides)

  Object.defineProperty(factory, 'definition', { value: Object.freeze({ ...options }) })

  return factory
}
