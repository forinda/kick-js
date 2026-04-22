import type { ContributorRegistration } from './context-decorator'
import {
  ContributorCycleError,
  DuplicateContributorError,
  MissingContributorError,
} from './context-errors'

/**
 * Where a contributor was registered, ordered by precedence
 * (lower index wins). Mirrors `architecture.md` §20.4.
 *
 * Levels (highest → lowest precedence):
 * - `'method'` — `@LoadX` on a controller method.
 * - `'class'`  — `@LoadX` on a controller class.
 * - `'module'` — returned by `AppModule.contributors?()`. Per-module scope.
 * - `'adapter'` — returned by `AppAdapter.contributors?()`. Cross-cutting, applies
 *   to every module's routes.
 * - `'global'` — `ApplicationOptions.contributors`. App-wide default.
 */
export type ContributorSource = 'method' | 'class' | 'module' | 'adapter' | 'global'

/** Precedence-ranked source list. Index = precedence; method (0) wins ties. */
const PRECEDENCE_ORDER: readonly ContributorSource[] = [
  'method',
  'class',
  'module',
  'adapter',
  'global',
]

/**
 * Input row to {@link buildPipeline}. Pairs a registration with its origin
 * so dedup can apply the precedence rule and diagnostic errors can name
 * the offending site.
 */
export interface SourcedRegistration {
  registration: ContributorRegistration
  source: ContributorSource
  /** Human label surfaced in DuplicateContributorError messages. */
  label?: string
}

/**
 * Resolved, validated, topo-sorted pipeline ready for execution.
 *
 * `contributors` is in execution order — every entry's `dependsOn`
 * keys appear earlier. `keys` is the set of all keys this pipeline
 * produces; the runner uses it for fast existence checks and the
 * builder uses it for missing-dep validation.
 */
export interface ContributorPipeline {
  readonly contributors: readonly ContributorRegistration[]
  readonly keys: ReadonlySet<string>
}

export interface BuildPipelineOptions {
  /** Optional route identifier surfaced in diagnostic errors (e.g., 'GET /projects/:id'). */
  route?: string
}

/**
 * Build, validate, and topo-sort a contributor pipeline.
 *
 * Pipeline:
 *
 * 1. Group sources by precedence (method > class > module > adapter > global).
 * 2. Within each precedence level, two contributors with the same `key`
 *    raise {@link DuplicateContributorError}.
 * 3. Across levels, the highest-precedence contributor wins each key
 *    (lower-precedence duplicates are silently dropped — that is the
 *    documented override mechanism, not an error).
 * 4. Every key referenced by `dependsOn` must be produced by the
 *    surviving set, otherwise {@link MissingContributorError}.
 * 5. Kahn's algorithm topo-sorts the survivors. Any nodes left after
 *    the queue drains form a cycle → {@link ContributorCycleError}
 *    with a reconstructed path.
 *
 * Pure function — no DI, no I/O. Safe to call once at startup per
 * route and cache the result.
 */
export function buildPipeline(
  sources: readonly SourcedRegistration[],
  options: BuildPipelineOptions = {},
): ContributorPipeline {
  const route = options.route

  // Step 1: group by source.
  const bySource = new Map<ContributorSource, SourcedRegistration[]>()
  for (const src of PRECEDENCE_ORDER) bySource.set(src, [])
  for (const entry of sources) bySource.get(entry.source)!.push(entry)

  // Step 2 + 3: dedup with precedence. We walk highest precedence first,
  // claim its keys, and drop lower-precedence rows that conflict.
  const winners = new Map<string, SourcedRegistration>()
  for (const src of PRECEDENCE_ORDER) {
    const rows = bySource.get(src)!
    const keysAtThisLevel = new Map<string, SourcedRegistration[]>()
    for (const row of rows) {
      const key = row.registration.key
      const existing = keysAtThisLevel.get(key) ?? []
      existing.push(row)
      keysAtThisLevel.set(key, existing)
    }
    for (const [key, rowsForKey] of keysAtThisLevel) {
      if (rowsForKey.length > 1) {
        const labels = rowsForKey.map((r, i) => r.label ?? `${src}#${i}`)
        throw new DuplicateContributorError(key, labels)
      }
      if (!winners.has(key)) winners.set(key, rowsForKey[0])
    }
  }

  const survivors = [...winners.values()].map((r) => r.registration)
  const allKeys = new Set(survivors.map((r) => r.key))

  // Step 4: dependsOn validation.
  for (const reg of survivors) {
    for (const dep of reg.dependsOn) {
      if (!allKeys.has(dep)) {
        throw new MissingContributorError(dep, reg.key, route)
      }
    }
  }

  // Step 5: Kahn topo-sort.
  const sorted = topoSort(survivors, route)

  return Object.freeze({
    contributors: Object.freeze(sorted),
    keys: allKeys,
  })
}

/**
 * Kahn's algorithm with deterministic ordering on ties.
 *
 * Nodes with no remaining incoming edges enter the queue in input
 * order. Cycles surface as nodes still present after the queue
 * drains; we reconstruct one cycle path for diagnostics.
 */
function topoSort(
  registrations: readonly ContributorRegistration[],
  route: string | undefined,
): ContributorRegistration[] {
  // indegree[key] = number of unresolved dependsOn entries for key
  const indegree = new Map<string, number>()
  // dependents[depKey] = list of registrations that depend on depKey
  const dependents = new Map<string, ContributorRegistration[]>()
  const byKey = new Map<string, ContributorRegistration>()

  for (const reg of registrations) {
    indegree.set(reg.key, reg.dependsOn.length)
    byKey.set(reg.key, reg)
  }
  for (const reg of registrations) {
    for (const dep of reg.dependsOn) {
      const list = dependents.get(dep) ?? []
      list.push(reg)
      dependents.set(dep, list)
    }
  }

  // Initial queue: registrations with zero indegree, preserving input order.
  const queue: ContributorRegistration[] = []
  for (const reg of registrations) {
    if (indegree.get(reg.key) === 0) queue.push(reg)
  }

  const sorted: ContributorRegistration[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)
    for (const dependent of dependents.get(node.key) ?? []) {
      const next = (indegree.get(dependent.key) ?? 0) - 1
      indegree.set(dependent.key, next)
      if (next === 0) queue.push(dependent)
    }
  }

  if (sorted.length !== registrations.length) {
    const remaining = registrations.filter((r) => (indegree.get(r.key) ?? 0) > 0)
    throw new ContributorCycleError(reconstructCycle(remaining, byKey), route)
  }

  return sorted
}

/**
 * Reconstruct one cycle path from the residual graph.
 *
 * Walks from any remaining node, following its first dependency that's
 * still in the residual set, until we revisit a node. The path returned
 * starts and ends with the same key so the message reads naturally:
 * `tenant → project → tenant`.
 */
function reconstructCycle(
  residual: readonly ContributorRegistration[],
  byKey: ReadonlyMap<string, ContributorRegistration>,
): string[] {
  const residualKeys = new Set(residual.map((r) => r.key))
  const start = residual[0].key
  const path: string[] = [start]
  const seen = new Set<string>([start])
  let cursor: string = start

  while (true) {
    const reg = byKey.get(cursor)!
    const nextDep = reg.dependsOn.find((d) => residualKeys.has(d))
    if (nextDep === undefined) break
    if (seen.has(nextDep)) {
      // Trim the prefix that isn't part of the cycle.
      const cycleStart = path.indexOf(nextDep)
      return [...path.slice(cycleStart), nextDep]
    }
    path.push(nextDep)
    seen.add(nextDep)
    cursor = nextDep
  }

  // Fallback — couldn't reconstruct a strict cycle, return what we walked.
  return path
}
