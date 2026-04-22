/**
 * Topological sort for plugins and adapters with `dependsOn` declarations.
 *
 * Mirrors the algorithm used by the Context Contributor pipeline
 * (`contributor-pipeline.ts:topoSort`) but operates on a name-keyed
 * `MountSortItem` shape rather than a `ContributorRegistration`. Kept
 * standalone instead of factored generic so that:
 *
 * 1. The contributor pipeline doesn't need refactoring (risk reduction).
 * 2. The error classes can carry plugin/adapter-specific diagnostic
 *    fields (`kind`, `dependent`) without bending the contributor types.
 */

/**
 * A plugin or adapter that participates in dependency-ordered mounting.
 * Both `KickPlugin` and `AppAdapter` satisfy this shape via their `name`
 * and `dependsOn` fields.
 */
export interface MountSortItem {
  /** Unique mount name within the plugin/adapter set being sorted. */
  name: string
  /**
   * Other plugin/adapter names that must mount before this one. Cycles
   * and missing names fail at boot — same fail-fast contract as the
   * Context Contributor pipeline (architecture.md §20.4).
   */
  dependsOn?: readonly string[]
}

/** What kind of mount set the sort is operating on — surfaces in error messages. */
export type MountKind = 'plugin' | 'adapter'

/**
 * Two items in the same mount set declared the same `name`. Plugin/adapter
 * names must be unique so `dependsOn` references resolve unambiguously.
 */
export class DuplicateMountNameError extends Error {
  readonly kind: MountKind
  readonly mountName: string

  constructor(kind: MountKind, mountName: string) {
    super(`Duplicate ${kind} name '${mountName}' — every ${kind} must declare a unique name`)
    this.name = 'DuplicateMountNameError'
    this.kind = kind
    this.mountName = mountName
  }
}

/**
 * A `dependsOn` entry references a plugin/adapter that isn't in the
 * current set. The dependency might not be installed, might be misspelled,
 * or might live in a different mount set (plugin referencing an adapter,
 * or vice versa — they sort independently).
 */
export class MissingMountDepError extends Error {
  readonly kind: MountKind
  readonly missing: string
  readonly dependent: string

  constructor(kind: MountKind, missing: string, dependent: string) {
    super(
      `Missing ${kind} dependency '${missing}' required by '${dependent}' — ` +
        `is the ${kind} installed and named correctly?`,
    )
    this.name = 'MissingMountDepError'
    this.kind = kind
    this.missing = missing
    this.dependent = dependent
  }
}

/**
 * The `dependsOn` declarations form a cycle. Boot fails so the cycle
 * can't poison live traffic. The `cycle` field reports one path through
 * the offending nodes for diagnostics — formatted `A → B → C → A`.
 */
export class MountCycleError extends Error {
  readonly kind: MountKind
  readonly cycle: readonly string[]

  constructor(kind: MountKind, cycle: readonly string[]) {
    super(`Cycle in ${kind} dependsOn declarations: ${cycle.join(' → ')}`)
    this.name = 'MountCycleError'
    this.kind = kind
    this.cycle = Object.freeze([...cycle])
  }
}

/**
 * Topologically sort `items` so every item with `dependsOn: ['X']` mounts
 * after `X`. Items without `dependsOn` keep their input order via Kahn's
 * algorithm with a FIFO queue seeded in input order — preserves the
 * historical "plugins/adapters mount in declaration order" behaviour for
 * any set that doesn't use `dependsOn`.
 *
 * @param items - mountable items, e.g. plugins or adapters
 * @param kind - 'plugin' | 'adapter', used in error messages
 * @returns a new array in valid mount order
 * @throws {DuplicateMountNameError} two items share a name
 * @throws {MissingMountDepError} a `dependsOn` references an unknown name
 * @throws {MountCycleError} the dep graph contains a cycle
 */
export function mountSort<T extends MountSortItem>(items: readonly T[], kind: MountKind): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    if (byName.has(item.name)) {
      throw new DuplicateMountNameError(kind, item.name)
    }
    byName.set(item.name, item)
  }

  // indegree[name] = number of unresolved deps for that item
  const indegree = new Map<string, number>()
  // dependents[depName] = items that depend on depName
  const dependents = new Map<string, T[]>()

  for (const item of items) {
    indegree.set(item.name, item.dependsOn?.length ?? 0)
  }
  for (const item of items) {
    for (const dep of item.dependsOn ?? []) {
      if (!byName.has(dep)) {
        throw new MissingMountDepError(kind, dep, item.name)
      }
      const list = dependents.get(dep) ?? []
      list.push(item)
      dependents.set(dep, list)
    }
  }

  // Initial queue: items with zero indegree, preserving input order.
  const queue: T[] = []
  for (const item of items) {
    if (indegree.get(item.name) === 0) queue.push(item)
  }

  const sorted: T[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)
    for (const dependent of dependents.get(node.name) ?? []) {
      const next = (indegree.get(dependent.name) ?? 0) - 1
      indegree.set(dependent.name, next)
      if (next === 0) queue.push(dependent)
    }
  }

  if (sorted.length !== items.length) {
    const remaining = items.filter((it) => (indegree.get(it.name) ?? 0) > 0)
    throw new MountCycleError(kind, reconstructCycle(remaining, byName))
  }

  return sorted
}

/**
 * Walk the residual graph to find one cycle path for diagnostics.
 * Starts from the first remaining node and follows the first dep that's
 * still in the residual set until we revisit a node. Returns a path
 * starting and ending with the same name so the message reads naturally
 * (`A → B → C → A`).
 */
function reconstructCycle<T extends MountSortItem>(
  residual: readonly T[],
  byName: ReadonlyMap<string, T>,
): string[] {
  const residualNames = new Set(residual.map((r) => r.name))
  const start = residual[0].name
  const path: string[] = [start]
  const seen = new Set<string>([start])
  let cursor = start

  while (true) {
    const item = byName.get(cursor)!
    const nextDep = item.dependsOn?.find((d) => residualNames.has(d))
    if (nextDep === undefined) break
    if (seen.has(nextDep)) {
      const cycleStart = path.indexOf(nextDep)
      return [...path.slice(cycleStart), nextDep]
    }
    path.push(nextDep)
    seen.add(nextDep)
    cursor = nextDep
  }

  return path
}
