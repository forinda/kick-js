/**
 * Errors thrown by the Context Contributor pipeline.
 *
 * All three are startup-time errors raised during pipeline build (topo-sort
 * + validation), not per-request — a misconfigured app fails to boot rather
 * than fails a request. Per the locked design in `architecture.md` §20.4,
 * the pipeline is validated once when each route is mounted and the
 * resolved order is cached on the route.
 */

/**
 * A contributor declared `dependsOn: ['<key>']` but no other contributor
 * (at any precedence level) produces that key for the same route.
 *
 * @example
 * ```text
 * MissingContributorError: Missing context contributor 'tenant' required by 'project' on route GET /projects/:id
 * ```
 */
export class MissingContributorError extends Error {
  readonly key: string
  readonly dependent: string
  readonly route?: string

  constructor(key: string, dependent: string, route?: string) {
    const where = route ? ` on route ${route}` : ''
    super(`Missing context contributor '${key}' required by '${dependent}'${where}`)
    this.name = 'MissingContributorError'
    this.key = key
    this.dependent = dependent
    this.route = route
  }
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
 * global, per architecture.md §20.4) silently drops lower-precedence
 * duplicates; this error fires only when ties occur within a single level
 * — e.g., two method-level decorators declaring `key: 'tenant'`.
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
