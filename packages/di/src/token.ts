/**
 * Collision-safe injection tokens with phantom type parameters.
 *
 * `createToken<T>(name)` is the recommended way to declare any DI token
 * that isn't a class. Each call returns a unique frozen object — even if
 * two files write `createToken<X>('Logger')`, they produce two distinct
 * references that the container treats as different tokens. Collisions
 * become impossible by construction, not by convention.
 *
 * The phantom type parameter `T` lets `container.resolve(token)` infer
 * the correct return type without any codegen.
 *
 * ## Hardening layers
 *
 * KickJS has four DI token kinds, listed from safest to riskiest:
 *
 * 1. **Class identity** — `container.resolve(UserService)`. Reference
 *    equality, never collides. Type-safe via `Constructor<T>` overload.
 * 2. **`createToken<T>(name)`** — frozen object identity, never collides.
 *    Type-safe via the `InjectionToken<T>` overload.
 * 3. **Symbol** — `Symbol('foo')` is unique per call but `Symbol.for('foo')`
 *    is interned and CAN collide. Discouraged.
 * 4. **Raw string `@Inject('foo')`** — high collision risk, untyped.
 *    Reserved for legacy code and runtime-computed token names.
 *
 * Prefer (1) and (2). Use (4) only when you have to.
 *
 * @example
 * ```ts
 * // src/tokens.ts
 * export const DATABASE_URL = createToken<string>('config.database.url')
 * export const FEATURE_FLAGS = createToken<FeatureFlags>('app.features')
 *
 * // bootstrap
 * container.registerInstance(DATABASE_URL, process.env.DATABASE_URL!)
 *
 * // anywhere else
 * const url = container.resolve(DATABASE_URL) // typed as `string`
 * ```
 *
 * @module @forinda/kickjs/core/token
 */

/**
 * Symbol marker stamped on every InjectionToken so the container can
 * detect them at runtime regardless of which package created them.
 *
 * Uses `Symbol.for()` so cross-package isolation (different copies of
 * `@forinda/kickjs` loaded under different module identities) still
 * shares the same marker.
 */
export const INJECTION_TOKEN: unique symbol = Symbol.for('@kickjs/InjectionToken') as never

/**
 * A type-safe DI token. Each `createToken()` call returns a unique frozen
 * object identified by reference, not by the `name` string. Two
 * `createToken<X>('foo')` calls in different files produce two distinct
 * tokens that the container treats independently.
 *
 * The phantom `_type` parameter is never assigned at runtime — it exists
 * solely to thread the type through `container.resolve(token)`.
 */
export interface InjectionToken<T> {
  readonly [INJECTION_TOKEN]: true
  /** Descriptive name used in error messages, logs, and devtools */
  readonly name: string
  /** Phantom — never assigned at runtime */
  readonly _type?: T
}

/**
 * Create a collision-safe injection token.
 *
 * The returned token is a frozen object identified by reference, not by
 * the `name` string. The `name` is used only for error messages, logs,
 * and debugging.
 */
export function createToken<T>(name: string): InjectionToken<T> {
  return Object.freeze({
    [INJECTION_TOKEN]: true as const,
    name,
  })
}

/** Type guard — returns `true` if `value` is an InjectionToken */
export function isInjectionToken(value: unknown): value is InjectionToken<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[INJECTION_TOKEN] === true
  )
}
