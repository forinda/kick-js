/**
 * Errors thrown by the Context Contributor pipeline.
 *
 * `MissingContributorError`, `ContributorCycleError`, and
 * `DuplicateContributorError` are startup-time errors raised during
 * pipeline build (topo-sort + validation), not per-request — a
 * misconfigured app fails to boot rather than fails a request. Per the
 * locked design in `architecture.md` §20.4, the pipeline is validated
 * once when each route is mounted and the resolved order is cached on
 * the route.
 *
 * `MissingContextValueError` is the one request-time error here: it is
 * raised by `ctx.require(key)` when a value a handler declared it needs
 * is absent. See its doc comment for why that case can't be caught at
 * startup today.
 */

/**
 * A contributor declared `dependsOn: ['<key>']` but no other contributor
 * (at any precedence level) produces that key for the same route.
 *
 * @example
 * ```text
 * MissingContributorError: Missing context contributor 'tenant' required by 'project' on route GET /projects/:id
 *     declared at src/contributors/load-project.ts:42:18
 * ```
 */
export class MissingContributorError extends Error {
  readonly key: string
  readonly dependent: string
  readonly route?: string
  readonly dependentDefinedAt?: string

  constructor(key: string, dependent: string, route?: string, dependentDefinedAt?: string) {
    const where = route ? ` on route ${route}` : ''
    const declaredAt = formatDeclaredAt(dependentDefinedAt)
    super(`Missing context contributor '${key}' required by '${dependent}'${where}${declaredAt}`)
    this.name = 'MissingContributorError'
    this.key = key
    this.dependent = dependent
    this.route = route
    this.dependentDefinedAt = dependentDefinedAt
  }
}

/**
 * `ctx.require(key)` found no value under `key` in the per-request
 * metadata store.
 *
 * Thrown at request time, by design. `ctx.get(key)` returns
 * `T | undefined` for every key, so the usual workaround is a
 * non-null assertion — `ctx.get('tenant')!` — which compiles whether or
 * not the route actually carries the contributor that produces it. On
 * an authorization value that is the worst possible thing to leave
 * untypeable: dropping the decorator produces no diagnostic anywhere,
 * and the handler reads `undefined` as though it were a real value.
 *
 * `ctx.require()` converts that silent hole into a loud, named failure
 * that points at the missing contributor.
 *
 * A handler typed with a generated route type (`Ctx<KickRoutes…>`) also
 * gets compile-time narrowing, so a dropped decorator fails `tsc` rather
 * than reaching this error at all. This error remains the backstop for
 * routes typegen couldn't prove (module/adapter/bootstrap registrations),
 * handlers typed as plain `RequestContext`, and contributors that ran but
 * resolved to `undefined`. See `architecture.md` §20.14.
 *
 * @example
 * ```text
 * MissingContextValueError: No context value for 'tenantPerm' on GET /projects/:id
 *     Nothing wrote this key before the handler ran. Either the contributor
 *     that produces it isn't applied to this route, or it ran and resolved
 *     to undefined (check `optional: true` contributors).
 * ```
 */
export class MissingContextValueError extends Error {
  readonly key: string
  readonly route?: string

  constructor(key: string, route?: string) {
    const where = route ? ` on ${route}` : ''
    super(
      `No context value for '${key}'${where}\n` +
        `    Nothing wrote this key before the handler ran. Either the contributor\n` +
        `    that produces it isn't applied to this route, or it ran and resolved\n` +
        `    to undefined (check \`optional: true\` contributors).`,
    )
    this.name = 'MissingContextValueError'
    this.key = key
    this.route = route
  }
}

/**
 * Slice the first non-framework frame off a captured `Error.stack`
 * and format it as `\n    declared at <frame>` for inclusion in
 * boot-time error messages. Returns `''` when no useful frame is
 * available (hand-rolled registrations, missing stacks).
 */
function formatDeclaredAt(stack: string | undefined): string {
  if (!stack) return ''
  const lines = stack.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) continue
    // Skip frames inside this file or the decorator factory — the
    // adopter's call site is the next frame after those.
    if (trimmed.includes('context-decorator.')) continue
    if (trimmed.includes('context-errors.')) continue
    return `\n    declared at ${trimmed.replace(/^at /, '')}`
  }
  return ''
}

/**
 * Topo-sort detected a cycle in `dependsOn` declarations. The `cycle` field
 * lists the keys in the order they form the loop, with the first key
 * repeated at the end so the path reads naturally.
 *
 * @example
 * ```text
 * ContributorCycleError: Cycle in context contributors on route GET /projects/:id: tenant → project → tenant
 * ```
 */
export class ContributorCycleError extends Error {
  readonly cycle: readonly string[]
  readonly route?: string

  constructor(cycle: readonly string[], route?: string) {
    const where = route ? ` on route ${route}` : ''
    super(`Cycle in context contributors${where}: ${cycle.join(' → ')}`)
    this.name = 'ContributorCycleError'
    this.cycle = Object.freeze([...cycle])
    this.route = route
  }
}

/**
 * Two contributors at the same precedence level both produce the same key
 * for the same route. Precedence resolution (method > class > module >
 * adapter > global, per architecture.md §20.4) silently drops
 * lower-precedence duplicates; this error fires only when ties occur
 * within a single level — e.g., two method-level decorators declaring
 * `key: 'tenant'`.
 *
 * `sources` is best-effort identifying labels for each conflicting
 * registration (typically the decorator's call site or registering
 * module/adapter name).
 *
 * @example
 * ```text
 * DuplicateContributorError: Duplicate context contributor for key 'tenant' at the same precedence level. Sources: LoadTenantFromHeader, LoadTenantFromSubdomain
 * ```
 */
export class DuplicateContributorError extends Error {
  readonly key: string
  readonly sources: readonly string[]

  constructor(key: string, sources: readonly string[]) {
    super(
      `Duplicate context contributor for key '${key}' at the same precedence level. ` +
        `Sources: ${sources.join(', ')}`,
    )
    this.name = 'DuplicateContributorError'
    this.key = key
    this.sources = Object.freeze([...sources])
  }
}
