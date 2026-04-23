/**
 * Types + RPC envelopes shared between the DevTools runtime and any
 * plugin/adapter that integrates with it. Pure types + a single
 * identity factory (`defineDevtoolsTab`) — no runtime imports.
 *
 * The protocol version is bumped whenever the snapshot shape changes
 * incompatibly. DevTools panels check it before consuming a snapshot
 * so v1-only adopters don't crash on v2 fields they don't understand.
 *
 * @module @forinda/kickjs-devtools-kit/types
 */

/**
 * Wire-format protocol version. Bump when {@link IntrospectionSnapshot}
 * or {@link RuntimeSnapshot} get incompatible shape changes (renames,
 * removals, type narrowings). Additive optional fields don't bump.
 *
 * Vue's hard-won lesson: `@vue/devtools-api` exists purely as a v6/v7
 * compat shim because the original protocol shipped without a version
 * field. We pay the 8 bytes per snapshot upfront to avoid that.
 */
export const PROTOCOL_VERSION = 1 as const

/** Discriminator for what kind of primitive an introspection snapshot describes. */
export type IntrospectionKind = 'plugin' | 'adapter' | 'middleware' | 'contributor'

/**
 * Per-primitive snapshot returned by `introspect()` on a plugin/adapter.
 *
 * Cheap-by-default principle: `state` and `metrics` should be O(1) to
 * compute (counters, flags, recent samples). Anything that requires a DB
 * round trip or a full DI graph walk belongs behind a separate explicit
 * RPC, not in the base snapshot — DevTools polls topology aggressively.
 */
export interface IntrospectionSnapshot {
  /** Wire-protocol version this snapshot conforms to. */
  protocolVersion: typeof PROTOCOL_VERSION
  /** Stable identity matching the `name` from `definePlugin`/`defineAdapter`. */
  name: string
  /** What kind of primitive this is. */
  kind: IntrospectionKind
  /** Optional version string from the plugin/adapter metadata. */
  version?: string
  /**
   * Reactive state surface — JSON-serialisable snapshot. Keep small
   * (under a few KB) so polling stays cheap.
   */
  state?: Record<string, unknown>
  /** DI tokens this primitive registers (`provides`) or consumes (`requires`). */
  tokens?: { provides: readonly string[]; requires: readonly string[] }
  /**
   * Per-instance counters — active connections, in-flight jobs,
   * cached items, etc. Numbers only so the panel can chart trends.
   */
  metrics?: Record<string, number>
  /** Self-reported memory footprint estimate, in bytes. Optional. */
  memoryBytes?: number
}

/**
 * The optional method an adapter or plugin implements to expose itself
 * to DevTools. May be sync or async — DevTools awaits the result.
 *
 * Adapters that don't implement this still appear in topology with a
 * minimal `{ name, kind }` stub.
 */
export type IntrospectFn = () => IntrospectionSnapshot | Promise<IntrospectionSnapshot>

/**
 * Tab descriptor a plugin/adapter contributes to the DevTools panel.
 * Mirrors Nuxt's `ModuleCustomTab` shape — three view types so simple
 * "click a button" tabs don't have to ship a full iframe.
 */
export interface DevtoolsTabDescriptor {
  /** Stable tab identifier — used in URL hash + as a React-style key. */
  id: string
  /** Display name in the tab strip. */
  title: string
  /** Optional Iconify-style identifier or absolute URL. */
  icon?: string
  /**
   * Display category — DevTools groups tabs by this. Built-in
   * categories (`'app'`, `'modules'`, `'observability'`, `'debug'`)
   * autocomplete; arbitrary strings still type-check via the
   * `string & {}` brand which prevents the literals from being
   * absorbed into the wider `string` type.
   */
  category?: 'app' | 'modules' | 'observability' | 'debug' | (string & {})
  /** What renders inside the tab. */
  view: DevtoolsTabView
}

/** The three ways a tab's content can be sourced. */
export type DevtoolsTabView =
  | {
      /** Embed an external URL. The plugin serves the panel HTML itself. */
      type: 'iframe'
      src: string
    }
  | {
      /** Render a button list — each button posts to its server handler. */
      type: 'launch'
      actions: ReadonlyArray<{ id: string; label: string; description?: string }>
    }
  | {
      /** Inline HTML string the panel injects. Trusted source only. */
      type: 'html'
      html: string
    }

/**
 * Process-level runtime snapshot — sampled by `RuntimeSampler` on a
 * polling interval. Never per-adapter; that's what `IntrospectionSnapshot`
 * is for.
 */
export interface RuntimeSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  /** Wall-clock timestamp the sample was taken (ms since epoch). */
  timestamp: number
  /** `process.uptime()` in seconds. */
  uptimeSec: number
  /** `process.memoryUsage()` — RSS, heap, external, arrayBuffers. */
  memory: NodeJS.MemoryUsage
  /** `process.cpuUsage()` deltas in microseconds since the previous sample. */
  cpu: { userMicros: number; systemMicros: number }
  /** Event-loop delay percentiles in milliseconds. */
  eventLoop: { p50: number; p95: number; p99: number; max: number }
  /** GC counter + cumulative pause time in milliseconds since process start. */
  gc: { count: number; totalPauseMs: number }
}

/**
 * Coarse DI-token entry for the topology graph — mirrors
 * `Container.getRegistrations()` but trimmed to the fields the panel
 * actually renders. Full registration data (resolve counts, post-
 * construct status) stays available via the existing
 * `/_debug/container` endpoint.
 */
export interface TopologyTokenEntry {
  /** Token string identifier (DI registry key). */
  token: string
  /** Resolution scope — `'singleton' | 'transient' | 'request'` (or framework custom). */
  scope: string
  /** Kind tag — `'class' | 'value' | 'factory'` etc. */
  kind: string
  /** Whether the token has been resolved at least once. */
  instantiated: boolean
}

/**
 * Coarse Context Contributor entry for the topology graph. The full
 * pipeline (with deps, sources, etc.) is documented in
 * `architecture.md` §20; this surface is just enough for the panel to
 * draw the Module → Contributor edge.
 */
export interface TopologyContributorEntry {
  /** Contributor key — what it sets on `ctx.set(...)`. */
  key: string
  /** Source layer — `'method' | 'class' | 'module' | 'adapter' | 'global'`. */
  source: string
  /** Other contributor keys this one depends on. */
  dependsOn: readonly string[]
}

/**
 * Aggregate topology snapshot — combines plugins, adapters, contributors,
 * and DI tokens into one JSON-serialisable graph. Returned by the
 * DevTools `/_debug/topology` endpoint and consumed by the Topology tab
 * to render the plugin → adapter → contributor → token tree.
 *
 * Each plugin/adapter slot carries the full `IntrospectionSnapshot`
 * when the primitive implements `introspect()`; primitives that don't
 * are reduced to a stub with `protocolVersion + name + kind` only.
 */
export interface TopologySnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  /** Wall-clock timestamp when the snapshot was taken (ms since epoch). */
  timestamp: number
  /** All registered plugins, in mount order (post-dependsOn topo-sort). */
  plugins: IntrospectionSnapshot[]
  /** All registered adapters, in mount order (post-dependsOn topo-sort). */
  adapters: IntrospectionSnapshot[]
  /** All discovered Context Contributors. */
  contributors: TopologyContributorEntry[]
  /** All registered DI tokens. */
  diTokens: TopologyTokenEntry[]
  /**
   * Per-primitive introspection failures — a non-empty list signals
   * that one or more `introspect()` calls threw. The topology endpoint
   * still returns a 200 with the partial graph; tests assert this is
   * empty on the happy path.
   */
  errors: readonly TopologyError[]
}

/** A single introspection failure surfaced in {@link TopologySnapshot.errors}. */
export interface TopologyError {
  /** The plugin/adapter name whose introspect() threw. */
  name: string
  /** Discriminator. */
  kind: 'plugin' | 'adapter'
  /** Error message (`err.message`); never the stack to keep snapshots compact. */
  message: string
}

/**
 * Composite memory health signal derived from a window of
 * {@link RuntimeSnapshot}s plus the active-handle inventory. The Memory
 * tab uses this to drive the leak-warning badge.
 */
export interface MemoryHealth {
  protocolVersion: typeof PROTOCOL_VERSION
  /** Heap-growth slope in bytes per second over the analysed window. */
  heapGrowthBytesPerSec: number
  /**
   * Severity bucket derived from {@link heapGrowthBytesPerSec}:
   * `ok` < 5MB/min, `warn` < 20MB/min, `critical` >= 20MB/min.
   */
  heapGrowthSeverity: 'ok' | 'warn' | 'critical'
  /**
   * Average GC reclaim ratio over the recent window — `(before - after) / before`.
   * Trending toward zero suggests GC can't free anything (leak).
   */
  gcReclaimRatio: number
  /** Active handle count from `process.getActiveResourcesInfo()`. */
  activeHandles: number
  /** Per-type handle breakdown — Timeout / TCPSocket / etc. */
  handlesByType: Record<string, number>
  /**
   * Heap utilization vs `heap_size_limit` — values close to 1 mean the
   * process is approaching V8's hard cap.
   */
  heapUtilization: number
}

/** RPC envelope shared by every DevTools transport (HTTP, WS, IPC). */
export interface RpcRequest<TParams = unknown> {
  /** Caller-chosen identifier echoed in the matching {@link RpcResponse}. */
  id: string
  /** Method name the server should dispatch to. */
  method: string
  /** Method-specific parameters. */
  params?: TParams
}

/** Successful RPC response envelope. */
export interface RpcSuccess<TResult = unknown> {
  id: string
  result: TResult
  error?: never
}

/** Failed RPC response envelope — never sent alongside a result. */
export interface RpcFailure {
  id: string
  result?: never
  error: RpcError
}

/** Either form of RPC response — discriminated on `error`/`result` presence. */
export type RpcResponse<TResult = unknown> = RpcSuccess<TResult> | RpcFailure

/** Structured error attached to a failed RPC response. */
export interface RpcError {
  /** Stable error code — `RPC_NOT_FOUND`, `INTROSPECT_FAILED`, etc. */
  code: string
  /** Human-readable message safe to display in the panel. */
  message: string
  /** Optional structured payload (stack trace for dev mode, etc.). */
  data?: unknown
}

/**
 * Identity factory for {@link DevtoolsTabDescriptor}. Pure type helper —
 * exists so adapter authors get full TypeScript narrowing on the `view`
 * union without importing the type explicitly.
 *
 * @example
 * ```ts
 * const QueueTab = defineDevtoolsTab({
 *   id: 'queue',
 *   title: 'Queue',
 *   icon: 'tabler:list-tree',
 *   view: { type: 'iframe', src: '/_kick/queue/panel' },
 * })
 * ```
 */
export function defineDevtoolsTab(spec: DevtoolsTabDescriptor): DevtoolsTabDescriptor {
  return spec
}
