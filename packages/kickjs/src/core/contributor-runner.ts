import type { Container } from './container'
import type { ContributorRegistration } from './context-decorator'
import type { ExecutionContext } from './execution-context'
import type { ContributorPipeline } from './contributor-pipeline'
import { matchesFlagTest, type RouteFlags } from './route-flag'
import type { MatchedRoute } from '../http/runtime'

export interface RunContributorsOptions {
  /** Pre-built, validated, topo-sorted pipeline. */
  pipeline: ContributorPipeline
  /** The execution context contributors read from and write into. */
  ctx: ExecutionContext
  /** DI container used to resolve declared `deps`. */
  container: Container
  /**
   * Route flags in force for the matched route, used to honour a
   * registration's `skipWhen` / `onlyWhen`. Omitted outside a route (the
   * pipeline then runs every contributor, as before).
   */
  flags?: RouteFlags
}

/**
 * Should this contributor run on a route carrying `flags`?
 *
 * `skipWhen` is what makes exemption composable: today a contributor can only
 * be opted out of by registering a permissive twin under the same key, which
 * requires owning that key. A flag is declared on the route, so an adopter can
 * exempt a contributor shipped by a plugin without forking it.
 */
function shouldRun(
  reg: ContributorRegistration,
  ctx: ExecutionContext,
  flags?: RouteFlags,
): boolean {
  if (reg.skipWhen === undefined && reg.onlyWhen === undefined) return true
  const resolved = flags ?? EMPTY_FLAGS
  const route = (ctx as { route?: MatchedRoute }).route
  if (reg.skipWhen !== undefined && matchesFlagTest(reg.skipWhen, resolved, route)) return false
  if (reg.onlyWhen !== undefined && !matchesFlagTest(reg.onlyWhen, resolved, route)) return false
  return true
}

const EMPTY_FLAGS: RouteFlags = new Map() as RouteFlags

/**
 * Execute a built {@link ContributorPipeline} against an {@link ExecutionContext}.
 *
 * Sequential — one contributor at a time, in the topo order chosen at
 * pipeline-build time. Per `architecture.md` §20.10, V1 does not run
 * contributors in parallel even within the same topo level; that is a
 * V2 follow-up gated on profiling.
 *
 * ## Error matrix (architecture.md §20.9)
 *
 * | resolve outcome | optional | onError defined | runner behaviour                                 |
 * |-----------------|----------|-----------------|--------------------------------------------------|
 * | throws          | true     | —               | skip; `ctx.get(key)` remains undefined           |
 * | throws          | false    | yes             | call hook; returned value (if any) stored        |
 * | throws          | false    | no              | propagate the original error                     |
 * | hook throws     | —        | yes             | propagate the new error                          |
 * | hook returns    | —        | yes             | undefined/void → skip; value → `ctx.set(key, v)` |
 * | resolves        | —        | —               | `ctx.set(key, value)`                            |
 *
 * Container.resolve() throwing while building `deps` is treated as a
 * resolve-side throw and flows through the same matrix — adopters who
 * need different behaviour for missing-DI vs. data-lookup failures can
 * wrap the container access inside their own `resolve()`.
 */
export async function runContributors(options: RunContributorsOptions): Promise<void> {
  const { pipeline, ctx, container, flags } = options

  for (const reg of pipeline.contributors) {
    if (!shouldRun(reg, ctx, flags)) continue
    await runOne(reg, ctx, container)
  }
}

async function runOne(
  reg: ContributorRegistration,
  ctx: ExecutionContext,
  container: Container,
): Promise<void> {
  let value: unknown
  try {
    const deps = resolveDeps(reg, container)
    value = await reg.resolve(ctx, deps)
  } catch (err) {
    if (reg.optional) return
    if (reg.onError) {
      // Hook throws are unconditionally propagated — there is no
      // second-chance hook. Returning undefined/void from the hook
      // means "skip"; returning a value means "use this instead".
      const replacement = await reg.onError(err, ctx)
      if (replacement === undefined) return
      ctx.set(reg.key, replacement as never)
      return
    }
    throw err
  }
  ctx.set(reg.key, value as never)
}

/**
 * Resolve a contributor's declared dependencies through the container,
 * preserving the property names from the spec so `resolve(ctx, deps)`
 * receives exactly the shape the user wrote.
 *
 * Empty `deps` produces an empty object — `resolve()` always sees an
 * object, never `undefined`.
 */
function resolveDeps(reg: ContributorRegistration, container: Container): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, token] of Object.entries(reg.deps)) {
    out[key] = container.resolve(token as never)
  }
  return out
}
