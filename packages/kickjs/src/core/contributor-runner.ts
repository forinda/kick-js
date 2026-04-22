import type { Container } from './container'
import type { ContributorRegistration } from './context-decorator'
import type { ExecutionContext } from './execution-context'
import type { ContributorPipeline } from './contributor-pipeline'

export interface RunContributorsOptions {
  /** Pre-built, validated, topo-sorted pipeline. */
  pipeline: ContributorPipeline
  /** The execution context contributors read from and write into. */
  ctx: ExecutionContext
  /** DI container used to resolve declared `deps`. */
  container: Container
}

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
 * need different behaviour for missing-DI vs. data-fetch failures can
 * wrap the container access inside their own `resolve()`.
 */
export async function runContributors(options: RunContributorsOptions): Promise<void> {
  const { pipeline, ctx, container } = options

  for (const reg of pipeline.contributors) {
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
