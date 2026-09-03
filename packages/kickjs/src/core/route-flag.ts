/**
 * Route flags — a named, inheritable fact about a route (spec:
 * `route-flags-design.md`).
 *
 * A flag carries no behaviour. It records something about the route that any
 * consumer may read: `auth.public`, `csrf.exempt`, `rate.limit`. Auth reads it
 * to skip a contributor, a guard reads it to return early, Swagger reads it to
 * mark a security scheme — none of them needs to know about the others.
 *
 * The rule that makes presence checks safe: a flag resolves to **absent**, or
 * **present with a value defaulting to `true`**. There is no present-but-false
 * state, so `flags.has(name)` is always the right question for a boolean flag.
 * `@Public(false)` on a method does not store `false` — it removes the flag the
 * class put there. Without that, `has('auth.public')` would answer `true` for
 * the route that just opted back IN, which is an authorization bypass rather
 * than a papercut.
 */
import { METADATA } from './interfaces'
import { getClassMeta, getMethodMeta, pushClassMeta, pushMethodMeta } from './metadata'

/**
 * Augmentable route-flag registry — the flag counterpart of `ContextMeta`.
 *
 * Declare a project's flags here and every use of them narrows: a misspelt
 * name is a compile error rather than a flag that silently never matches, and
 * `flags.get('rate.limit')` comes back typed instead of `unknown`.
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface KickRouteFlags {
 *     'auth.public': true
 *     'rate.limit': { rpm: number }
 *   }
 * }
 * ```
 *
 * The interface is empty by default, and everything below falls back to plain
 * `string` while it stays that way — a project that has not augmented anything
 * keeps compiling exactly as before. The narrowing switches on with the first
 * declaration.
 *
 * The framework itself declares nothing here: it ships the mechanism and names
 * no flags, so `auth.public` above is a name you chose.
 *
 * Two constraints on what you can declare:
 * - A name cannot start with `!` — that prefix means "does not carry this flag"
 *   in a {@link RouteFlagTest}, and `defineRouteFlag` rejects it.
 * - A value type should not include `false`, which is the deletion sentinel:
 *   `@Flag(false)` removes the flag rather than storing `false`, so
 *   `flags.get()` can never return it (its result type excludes `false` to say
 *   so).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface KickRouteFlags {}

/**
 * A flag name. Narrows to the declared keys once {@link KickRouteFlags} is
 * augmented, and stays `string` until then — the same
 * `[Known] extends [never]` fallback `ContextMetaKey` uses, for the same
 * reason: first-day code must keep compiling.
 */
export type RouteFlagName = [keyof KickRouteFlags] extends [never]
  ? string
  : keyof KickRouteFlags & string

/**
 * The value type declared for a flag, defaulting to `true` for a bare flag and
 * `unknown` for a name the registry does not know.
 */
export type RouteFlagValue<K extends string, Fallback = unknown> = K extends keyof KickRouteFlags
  ? KickRouteFlags[K]
  : Fallback

/** One `@Flag` application, before precedence resolution. */
export interface RouteFlagDeclaration {
  readonly name: string
  /** `false` means "remove whatever a lower-precedence site declared". */
  readonly value: unknown
}

/**
 * A flag decorator. Usable bare (`@Public`) or called with a value
 * (`@Public(false)`, `@RateLimit({ rpm: 10 })`), on a class or a method.
 */
/**
 * The bare application forms — `@Public` with no call.
 *
 * Split out so they can be withheld from a flag whose declared value is not
 * assignable from `true`: applying `@Limit` bare would store `true` while
 * `flags.get('rate.limit')` promises `{ rpm: number }`, and nothing would catch
 * the mismatch until a consumer read the wrong shape at runtime.
 */
export interface BareRouteFlag {
  /**
   * Bare on a class. Typed against `Function` rather than `object` so a flag
   * VALUE that happens to be an object (`@Limit({ rpm: 10 })`) cannot match
   * this signature: overload resolution would otherwise pick it, return
   * `void`, and fail with "Type 'void' has no call signatures".
   */
  (target: Function): void
  /**
   * Bare on a method. `propertyKey` is required for the same reason — it makes
   * a one-argument call unambiguous.
   */
  (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void
}

/** The called form — `@Public(false)`, `@Limit({ rpm: 10 })`. */
export interface ValuedRouteFlag<V> {
  (value: V | false): (target: object, propertyKey?: string | symbol) => void
  readonly flagName: string
}

/**
 * A flag decorator.
 *
 * Bare application is available only when `true` is a valid value for the flag
 * — which is every flag until {@link KickRouteFlags} declares a value type for
 * it. Declare `'rate.limit': { rpm: number }` and `@RateLimit` on its own stops
 * compiling, because the value it would store is not the value the registry
 * promises readers.
 */
export type RouteFlag<V = true> = true extends V
  ? BareRouteFlag & ValuedRouteFlag<V>
  : ValuedRouteFlag<V>

/**
 * True when the arguments look like a decorator application rather than a
 * value. The two forms are `@Public` (TS calls it for us) and `@Public(v)`
 * (we return the decorator).
 *
 * Discrimination has to be exact, because a value can be an object:
 * `@RateLimit({ rpm: 10 })` is a single object argument, and treating it as a
 * class-decorator target silently drops the flag.
 *
 * - method decorator → `(prototype, 'name', descriptor?)`, so arg 1 is a
 *   string or symbol
 * - class decorator → `(constructor)`, a single *function* argument
 * - anything else → a value
 */
function isDecoratorApplication(args: unknown[]): boolean {
  const [target, propertyKey] = args
  if (typeof propertyKey === 'string' || typeof propertyKey === 'symbol') return true
  return args.length === 1 && typeof target === 'function'
}

/**
 * Define a route flag.
 *
 * ```ts
 * export const Public = defineRouteFlag('auth.public')
 * export const RateLimit = defineRouteFlag<{ rpm: number }>('rate.limit')
 * ```
 *
 * Once {@link KickRouteFlags} declares the name, the value type comes from the
 * registry and the explicit generic is redundant:
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface KickRouteFlags {
 *     'rate.limit': { rpm: number }
 *   }
 * }
 *
 * const RateLimit = defineRouteFlag('rate.limit') // RouteFlag<{ rpm: number }>
 * ```
 */
export function defineRouteFlag<const N extends RouteFlagName>(
  name: N,
): RouteFlag<RouteFlagValue<N, true>>
export function defineRouteFlag<V>(name: RouteFlagName): RouteFlag<V>
export function defineRouteFlag(name: string): RouteFlag<never> {
  // `!` is reserved: a test string starting with it means "does NOT carry this
  // flag", so a flag literally named '!x' would be indistinguishable from the
  // negation of 'x' — `exemptWhen: '!x'` would silently stop meaning what the
  // author wrote. Rejecting at definition is the only point where the two can
  // still be told apart.
  if (name.startsWith('!')) {
    throw new Error(
      `defineRouteFlag('${name}'): a flag name cannot start with '!' — that prefix is reserved ` +
        `for negated tests ('!${name.slice(1)}' means "does not carry ${name.slice(1)}"). ` +
        `Rename the flag.`,
    )
  }

  function apply(value: unknown, target: object, propertyKey?: string | symbol): void {
    const declaration: RouteFlagDeclaration = { name, value }
    if (propertyKey === undefined) {
      pushClassMeta<RouteFlagDeclaration>(METADATA.CLASS_FLAGS, target, declaration)
      return
    }
    // Method decorators receive the prototype; metadata helpers key off the
    // constructor so class + method lookups land in the same place.
    pushMethodMeta<RouteFlagDeclaration>(
      METADATA.METHOD_FLAGS,
      (target as { constructor: object }).constructor,
      String(propertyKey),
      declaration,
    )
  }

  const flag = (...args: unknown[]): unknown => {
    if (isDecoratorApplication(args)) {
      // Bare form: @Public
      apply(true, args[0] as object, args[1] as string | symbol | undefined)
      return undefined
    }
    // Called form: @Public(false) / @RateLimit({ rpm: 10 })
    const value = args[0]
    return (target: object, propertyKey?: string | symbol): void => {
      apply(value, target, propertyKey)
    }
  }

  Object.defineProperty(flag, 'flagName', { value: name, enumerable: true })
  return flag as RouteFlag<never>
}

/**
 * Resolve the flags in force for one route.
 *
 * Precedence is method > class, matching the contributor pipeline's top two
 * levels. Within a level the last declaration wins (decorators apply bottom-up,
 * so the one nearest the handler is applied last).
 *
 * A resolved `false` deletes the key rather than storing it — see the module
 * docblock.
 */
export function resolveRouteFlags(
  classDeclarations: readonly RouteFlagDeclaration[],
  methodDeclarations: readonly RouteFlagDeclaration[],
): RouteFlags {
  const resolved = new Map<string, unknown>()

  // Lowest precedence first, so higher levels overwrite.
  for (const { name, value } of [...classDeclarations, ...methodDeclarations]) {
    if (value === false) {
      resolved.delete(name)
      continue
    }
    resolved.set(name, value)
  }

  // The map is built from declarations, so its value types are whatever the
  // registry says they are — this cast is the one place that knowledge crosses
  // from runtime data into the type system.
  return resolved as RouteFlags
}

/**
 * The resolved flags for a route.
 *
 * A `ReadonlyMap` whose `has` is narrowed to known names and whose `get`
 * returns the declared value type — so `flags.get('rate.limit')` is
 * `{ rpm: number } | undefined` rather than `unknown`, once the registry
 * declares it. Until then it behaves like `ReadonlyMap<string, unknown>`.
 */
export interface RouteFlags extends ReadonlyMap<string, unknown> {
  has(name: RouteFlagName): boolean
  /**
   * `false` is excluded from the result on purpose: it is the deletion
   * sentinel, so a flag resolved to `false` is *absent*, and `get` returns
   * `undefined` for it. A registry entry typed `boolean` would otherwise
   * promise a `false` that can never arrive.
   */
  get<K extends RouteFlagName>(name: K): Exclude<RouteFlagValue<K>, false> | undefined
}

/**
 * Argument handed to a flag predicate.
 *
 * `route` is undefined only where flags are consulted outside a matched route,
 * which today means a non-HTTP transport running the same contributor pipeline.
 */
export interface RouteFlagContext {
  readonly flags: RouteFlags
  readonly route?: {
    readonly method: string
    readonly path: string
    readonly controller?: unknown
    readonly handlerName?: string
  }
}

/**
 * A predicate form of a flag test, for conditions a single name cannot express:
 * two flags together, a flag's *value*, a path or controller check, an env
 * switch.
 *
 * ```ts
 * skipWhen: ({ flags }) => flags.has('auth.public') || flags.has('internal'),
 * skipWhen: ({ flags }) => (flags.get('rate.limit') as { rpm: number })?.rpm === 0,
 * skipWhen: ({ route }) => route?.path.startsWith('/webhooks') ?? false,
 * ```
 *
 * Keep predicates pure and cheap — they run per request, per contributor.
 */
export type RouteFlagPredicate = (ctx: RouteFlagContext) => boolean

/**
 * How a consumer names the routes it cares about.
 *
 * A bare name for the common case, a list when several flags mean the same
 * thing (matched **any-of**), a predicate for everything else — all-of, a
 * flag's value, the route's path.
 *
 * ```ts
 * skipWhen: 'auth.public'
 * skipWhen: ['auth.public', 'health.probe']            // either one
 * skipWhen: ({ flags }) => flags.has('a') && flags.has('b')   // both
 * ```
 */
/**
 * A flag name with `!` in front — matches routes that do **not** carry it.
 *
 * Narrows with the registry like the positive form: once `KickRouteFlags`
 * declares `'auth.public'`, this is `'!auth.public' | …`, so a misspelt
 * negation is a compile error too.
 */
export type NegatedRouteFlagName = `!${RouteFlagName}`

/**
 * How a consumer names the routes it cares about.
 *
 * - `'auth.public'` — carries the flag
 * - `'!auth.public'` — does **not** carry it
 * - `['a', 'b']` — carries **any** of them
 * - `['!a', '!b']` — carries **none** of them
 * - a predicate — anything else: all-of, a flag's value, the route's path
 *
 * Lists are single-polarity by construction: `['a', '!b']` matches neither
 * array member of this union, so it is a compile error. Mixed polarity has no
 * reading everyone agrees on — under any-of it means "a present OR b absent",
 * which most readers parse as "and" — and a predicate says it unambiguously.
 */
export type RouteFlagTest =
  | RouteFlagName
  | NegatedRouteFlagName
  | readonly RouteFlagName[]
  | readonly NegatedRouteFlagName[]
  | RouteFlagPredicate

/**
 * Evaluate a {@link RouteFlagTest} against a route's resolved flags.
 *
 * Shared by every consumer that can be exempted per route — the contributor
 * runner, `csrfGuard`, `rateLimitGuard` — so "which routes does this apply to"
 * means the same thing everywhere, and a list is any-of in all of them.
 */
export function matchesFlagTest(
  test: RouteFlagTest,
  flags: RouteFlags | undefined,
  route?: RouteFlagContext['route'],
): boolean {
  const resolved = flags ?? EMPTY_FLAGS
  if (typeof test === 'function') return test({ flags: resolved, route })

  if (typeof test === 'string') {
    return isNegated(test)
      ? !resolved.has(stripNegation(test))
      : resolved.has(test as RouteFlagName)
  }

  if (test.length === 0) return false

  // Single polarity per list — the type forbids mixing, and this guards the
  // untyped callers (plain JS, a value read from config) that the type cannot.
  const negated = isNegated(test[0])
  if (test.some((name) => isNegated(name) !== negated)) {
    throw new Error(
      `Route flag test mixes polarities: [${test.map((n) => `'${n}'`).join(', ')}]. ` +
        `A list is either all names ("carries any of these") or all negated ` +
        `("carries none of these") — for anything else, pass a predicate.`,
    )
  }

  // Positive list is any-of; negated list is its complement, none-of. The two
  // read as opposites, which is what makes flipping every entry do what a
  // reader expects.
  return negated
    ? test.every((name) => !resolved.has(stripNegation(name)))
    : test.some((name) => resolved.has(name as RouteFlagName))
}

/**
 * Reject a mixed-polarity list at construction time.
 *
 * A list like `['auth.public', '!metered']` is a static mistake, so it fails
 * where it is written — when the contributor or guard is built — rather than
 * on the first request that reaches it. Same reasoning as the contributor
 * pipeline failing a dependency cycle at boot.
 *
 * Call from every factory that accepts a {@link RouteFlagTest}; the check in
 * {@link matchesFlagTest} stays as a backstop for direct callers.
 */
export function assertFlagTest(test: RouteFlagTest, site: string): void {
  if (typeof test === 'function' || typeof test === 'string' || test.length === 0) return
  const negated = isNegated(test[0])
  if (test.some((name) => isNegated(name) !== negated)) {
    throw new Error(
      `${site}: route flag test mixes polarities: [${test.map((n) => `'${n}'`).join(', ')}]. ` +
        `A list is either all names ("carries any of these") or all negated ` +
        `("carries none of these") — for anything else, pass a predicate.`,
    )
  }
}

const isNegated = (name: string): boolean => name.startsWith('!')
const stripNegation = (name: string): RouteFlagName => name.slice(1) as RouteFlagName

const EMPTY_FLAGS: RouteFlags = new Map()

/**
 * Where the matched route is stashed for `ctx.route` to read.
 *
 * It lives on the **request object**, not on the RequestContext: the Express
 * runtime constructs a fresh `RequestContext` per middleware, so anything
 * written to one ctx is invisible to the next and to the handler. Fastify and
 * h3 build a single ctx per request and would not have shown the difference —
 * the cross-runtime test is what surfaced it.
 *
 * `Symbol.for` rather than a private symbol so a duplicated module instance
 * (pnpm hoisting, a bundled copy) still reads the same slot.
 */
export const ROUTE_SLOT: unique symbol = Symbol.for('kick.route') as never

/**
 * Resolve the flags in force for one handler, straight from the controller
 * class — the same method-over-class result `buildRouteTable` computes.
 *
 * For consumers that see a controller and a method name rather than a live
 * request: an adapter's `onRouteMount`, an OpenAPI generator, a DevTools route
 * listing. Inside a request, read `ctx.route.flags` instead — it is already
 * resolved.
 *
 * ```ts
 * // Mark flagged routes public in the OpenAPI spec:
 * SwaggerAdapter({
 *   bearerAuth: true,
 *   securityResolver: ({ controllerClass, handlerName }) =>
 *     getRouteFlags(controllerClass, handlerName).has('auth.public') ? null : undefined,
 * })
 * ```
 */
export function getRouteFlags(controllerClass: object, handlerName: string): RouteFlags {
  return resolveRouteFlags(
    getClassFlagDeclarations(controllerClass),
    getMethodFlagDeclarations(controllerClass, handlerName),
  )
}

/** Read the class-level declarations off a controller. */
export function getClassFlagDeclarations(controllerClass: object): RouteFlagDeclaration[] {
  return getClassMeta<RouteFlagDeclaration[]>(METADATA.CLASS_FLAGS, controllerClass, [])
}

/** Read the method-level declarations off a controller method. */
export function getMethodFlagDeclarations(
  controllerClass: object,
  handlerName: string,
): RouteFlagDeclaration[] {
  return getMethodMeta<RouteFlagDeclaration[]>(
    METADATA.METHOD_FLAGS,
    controllerClass,
    handlerName,
    [],
  )
}
