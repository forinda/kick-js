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
export interface RouteFlag<V = true> {
  (target: object, propertyKey?: string | symbol): void
  (value: V | false): (target: object, propertyKey?: string | symbol) => void
  readonly flagName: string
}

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
 */
export function defineRouteFlag<V = true>(name: string): RouteFlag<V> {
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
  return flag as RouteFlag<V>
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
): ReadonlyMap<string, unknown> {
  const resolved = new Map<string, unknown>()

  // Lowest precedence first, so higher levels overwrite.
  for (const { name, value } of [...classDeclarations, ...methodDeclarations]) {
    if (value === false) {
      resolved.delete(name)
      continue
    }
    resolved.set(name, value)
  }

  return resolved
}

/**
 * Argument handed to a flag predicate.
 *
 * `route` is undefined only where flags are consulted outside a matched route,
 * which today means a non-HTTP transport running the same contributor pipeline.
 */
export interface RouteFlagContext {
  readonly flags: ReadonlyMap<string, unknown>
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
export type RouteFlagTest = string | readonly string[] | RouteFlagPredicate

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
