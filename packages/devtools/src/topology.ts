/**
 * Topology aggregator — walks the running KickJS application + DI
 * container and produces a JSON-serialisable {@link TopologySnapshot}.
 *
 * Calls `introspect()` on every plugin and adapter that implements it
 * (architecture.md §23.3); falls back to a minimal `{ protocolVersion,
 * name, kind }` stub for primitives that don't. Per-primitive
 * introspection failures are caught + collected into the snapshot's
 * `errors` field rather than failing the entire endpoint.
 *
 * @module @forinda/kickjs-devtools/topology
 */

import type { AppAdapter, Container, KickPlugin } from '@forinda/kickjs'
import {
  PROTOCOL_VERSION,
  type IntrospectionSnapshot,
  type TopologyContributorEntry,
  type TopologyError,
  type TopologySnapshot,
  type TopologyTokenEntry,
} from '@forinda/kickjs-devtools-kit'

/** Minimal Application surface the aggregator needs — keeps coupling thin. */
export interface TopologyApplicationLike {
  getAdapters(): AppAdapter[]
  getPlugins(): readonly KickPlugin[]
}

/** Inputs to {@link collectTopologySnapshot}. */
export interface CollectTopologyOptions {
  /** The running KickJS application (or anything that exposes its surface). */
  app: TopologyApplicationLike
  /** The DI container — used to enumerate registered tokens. */
  container: Container
  /**
   * Optional per-call introspect timeout in milliseconds. An adapter
   * whose `introspect()` doesn't settle within the budget gets a stub
   * snapshot + an entry in `errors`. Default: 100ms — keeps the
   * topology endpoint snappy even if one adapter misbehaves.
   */
  introspectTimeoutMs?: number
}

const DEFAULT_INTROSPECT_TIMEOUT_MS = 100

/**
 * Collect a {@link TopologySnapshot} for the given application.
 *
 * Async because plugin/adapter `introspect()` may be async; the work
 * is parallelised across all primitives so wall-clock time scales
 * with the slowest introspector, not their sum.
 */
export async function collectTopologySnapshot(
  opts: CollectTopologyOptions,
): Promise<TopologySnapshot> {
  const { app, container, introspectTimeoutMs = DEFAULT_INTROSPECT_TIMEOUT_MS } = opts
  const errors: TopologyError[] = []

  const plugins = await Promise.all(
    app.getPlugins().map((p) => snapshotFor(p, 'plugin', introspectTimeoutMs, errors)),
  )
  const adapters = await Promise.all(
    app.getAdapters().map((a) => snapshotFor(a, 'adapter', introspectTimeoutMs, errors)),
  )

  return {
    protocolVersion: PROTOCOL_VERSION,
    timestamp: Date.now(),
    plugins,
    adapters,
    contributors: collectContributors(app),
    diTokens: collectTokens(container),
    errors,
  }
}

/**
 * Coerce one primitive into an {@link IntrospectionSnapshot}. Tries
 * the primitive's own `introspect()` first; falls back to a stub on
 * any of: missing implementation, throw, timeout, or non-object return.
 */
async function snapshotFor(
  primitive: AppAdapter | KickPlugin,
  kind: 'plugin' | 'adapter',
  timeoutMs: number,
  errors: TopologyError[],
): Promise<IntrospectionSnapshot> {
  const name = primitive.name ?? '(unnamed)'
  const stub: IntrospectionSnapshot = {
    protocolVersion: PROTOCOL_VERSION,
    name,
    kind,
  }
  if (typeof primitive.introspect !== 'function') return stub

  try {
    const result = await Promise.race([
      Promise.resolve(primitive.introspect()),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`introspect() timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ])
    if (result && typeof result === 'object') {
      // Accept whatever the primitive returned; the kit's
      // IntrospectionSnapshot is opt-in typed via the kit, not enforced
      // at this layer (see plugin.ts / adapter.ts comment about avoiding
      // a runtime dep on the kit).
      const snap = result as Partial<IntrospectionSnapshot>
      return {
        protocolVersion: PROTOCOL_VERSION,
        name: snap.name ?? name,
        kind: snap.kind ?? kind,
        version: snap.version,
        state: snap.state,
        tokens: snap.tokens,
        metrics: snap.metrics,
        memoryBytes: snap.memoryBytes,
      }
    }
    return stub
  } catch (err) {
    errors.push({
      name,
      kind,
      message: err instanceof Error ? err.message : String(err),
    })
    return stub
  }
}

/** Read DI registrations into the topology shape — drops noisy HMR tokens. */
function collectTokens(container: Container): TopologyTokenEntry[] {
  return container
    .getRegistrations()
    .filter((r) => !r.token.startsWith('__hmr__'))
    .map((r) => ({
      token: r.token,
      scope: r.scope,
      kind: r.kind,
      instantiated: r.instantiated,
    }))
}

/**
 * Best-effort contributor enumeration. Plugins + adapters can both
 * return contributor registrations via `contributors()` — we walk both
 * lists, normalise the entries, and dedupe by `key`. Module-level
 * contributors (the most common case) are not enumerable from this
 * surface; the panel will surface them per-route in a later iteration.
 */
function collectContributors(app: TopologyApplicationLike): TopologyContributorEntry[] {
  const seen = new Map<string, TopologyContributorEntry>()

  const ingest = (
    list: ReadonlyArray<unknown> | null | undefined,
    source: TopologyContributorEntry['source'],
  ): void => {
    if (!list) return
    for (const reg of list) {
      const r = reg as { key?: string; dependsOn?: readonly string[] }
      const key = typeof r.key === 'string' ? r.key : null
      if (!key || seen.has(key)) continue
      seen.set(key, {
        key,
        source,
        dependsOn: Array.isArray(r.dependsOn) ? r.dependsOn : [],
      })
    }
  }

  for (const plugin of app.getPlugins()) {
    ingest(plugin.contributors?.(), 'adapter')
  }
  for (const adapter of app.getAdapters()) {
    ingest(adapter.contributors?.(), 'adapter')
  }

  return [...seen.values()]
}
