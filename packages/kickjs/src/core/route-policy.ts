/**
 * The route policy table — phase 3 of `route-flags-design.md`.
 *
 * Middleware mounted app-wide (the connect-style `rateLimit()`, `csrf()`) runs
 * *before* a route is matched, so it cannot read `ctx.route.flags`: there is no
 * route yet. That is also the reason to keep it there — an abuse control has to
 * see traffic that matches nothing, which a route-scoped guard never does.
 *
 * So the flags come to it instead. Every mounted route registers its method,
 * full path and resolved flags here at boot; a global middleware asks the table
 * what flags *would* apply to an incoming method + pathname.
 *
 * The table is per-Application, handed to middleware that opts in via
 * {@link bindRoutePolicy}. Nothing global: two apps in one process (a test file,
 * an embedded admin app) each get their own.
 */

import type { RouteFlags } from './route-flag'

/** Flags for one mounted route, keyed for lookup by an incoming request. */
interface PolicyEntry {
  /** Compiled from the mounted path — `/users/:id` → `^/users/([^/]+)$`. */
  readonly pattern: RegExp
  readonly flags: RouteFlags
}

const EMPTY: RouteFlags = new Map() as RouteFlags

/**
 * Turn a mounted path into a matcher.
 *
 * Deliberately small: `:param` matches one segment, `*` matches the rest, and
 * everything else is literal. This is a *lookup* over paths the engine already
 * chose to mount, not a second router — if it ever disagrees with the engine,
 * the answer is fewer features here, not more.
 */
function compile(path: string): RegExp {
  const source = path
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:[^/]+/g, '/([^/]+)')
    .replace(/\*/g, '.*')
  return new RegExp(`^${source}/?$`)
}

export class RoutePolicyTable {
  /** Bucketed by method: an incoming request only scans its own verb. */
  private readonly byMethod = new Map<string, PolicyEntry[]>()

  add(method: string, path: string, flags: RouteFlags | undefined): void {
    if (!flags || flags.size === 0) return // nothing to say about this route
    const verb = method.toUpperCase()
    const bucket = this.byMethod.get(verb) ?? []
    bucket.push({ pattern: compile(path), flags })
    this.byMethod.set(verb, bucket)
  }

  /**
   * Flags that apply to `method pathname`, or an empty map when the path
   * matches no flagged route — including when it matches no route at all,
   * which is exactly the traffic this exists to keep visible.
   */
  lookup(method: string, pathname: string): RouteFlags {
    const bucket = this.byMethod.get(method.toUpperCase())
    if (!bucket) return EMPTY
    for (const entry of bucket) {
      if (entry.pattern.test(pathname)) return entry.flags
    }
    return EMPTY
  }

  /** Drop everything — the Application rebuilds on every HMR reload. */
  clear(): void {
    this.byMethod.clear()
  }

  get size(): number {
    let total = 0
    for (const bucket of this.byMethod.values()) total += bucket.length
    return total
  }
}

/**
 * Slot a middleware exposes to say "hand me the policy table once routes are
 * mounted". The Application calls it during setup; middleware that never
 * declares it is untouched.
 */
export const ROUTE_POLICY_SLOT: unique symbol = Symbol.for('kick.routePolicy') as never

/** A middleware that accepts the policy table. */
export interface RoutePolicyAware {
  [ROUTE_POLICY_SLOT]?: (table: RoutePolicyTable) => void
}

/**
 * Declare that `handler` wants the policy table.
 *
 * Explicit hand-off rather than a module-level singleton, so the table a
 * middleware reads is always the one belonging to the app that mounted it.
 */
export function bindRoutePolicy<T extends object>(
  handler: T,
  receive: (table: RoutePolicyTable) => void,
): T {
  Object.defineProperty(handler, ROUTE_POLICY_SLOT, { value: receive, enumerable: false })
  return handler
}

/** Hand the table to a middleware if it declared the slot. */
export function offerRoutePolicy(handler: unknown, table: RoutePolicyTable): void {
  const receive = (handler as RoutePolicyAware | null)?.[ROUTE_POLICY_SLOT]
  if (typeof receive === 'function') receive(table)
}
