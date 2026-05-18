/**
 * Per-primitive introspection snapshot — the JSON shape an adapter or
 * plugin's optional `introspect()` hook returns for DevTools.
 *
 * Lives in `@forinda/kickjs` (not `@forinda/kickjs-devtools-kit`) so
 * adopters can type their `introspect()` return without taking on a
 * dep on the kit just to satisfy the contract. The kit's own
 * `IntrospectionSnapshot` type is structurally identical and continues
 * to be the canonical doc location for DevTools-side consumers; the
 * two stay in lockstep — if a field is added on one side it MUST be
 * added on the other (covered by the type-equivalence test in the
 * devtools-kit package).
 *
 * Cheap-by-default principle: `state` and `metrics` should be O(1) to
 * compute (counters, flags, recent samples). Anything that requires a
 * DB round trip or a full DI graph walk belongs behind a separate
 * explicit RPC — DevTools polls topology aggressively.
 */
export interface IntrospectionSnapshot {
  /**
   * Wire-protocol version this snapshot conforms to. The kit ships a
   * `PROTOCOL_VERSION` constant — adopters can set this field to
   * `1` directly without importing the constant; bumping it is a
   * coordinated kit + framework release.
   */
  protocolVersion: number
  /** Stable identity matching the `name` from `definePlugin` / `defineAdapter`. */
  name: string
  /** Discriminator for what kind of primitive this is. */
  kind: IntrospectionKind
  /** Optional version string from the plugin / adapter metadata. */
  version?: string
  /**
   * Reactive state surface — JSON-serialisable snapshot. Keep small
   * (under a few KB) so polling stays cheap.
   */
  state?: Record<string, unknown>
  /** DI tokens this primitive registers (`provides`) or consumes (`requires`). */
  tokens?: { provides: readonly string[]; requires: readonly string[] }
  /**
   * Per-instance counters — active connections, in-flight jobs, cached
   * items, etc. Numbers only so the DevTools panel can chart trends.
   */
  metrics?: Record<string, number>
  /** Self-reported memory footprint estimate, in bytes. Optional. */
  memoryBytes?: number
}

/**
 * What kind of primitive an introspection snapshot describes. Matches
 * the kit's `IntrospectionKind` and the routing the topology aggregator
 * does when bucketing adapters vs plugins vs middleware vs contributor
 * primitives.
 */
export type IntrospectionKind = 'plugin' | 'adapter' | 'middleware' | 'contributor'

/**
 * Convenience function signature for adopter-side helpers that return
 * a complete snapshot. Used by the optional `introspect?()` hook on
 * `AppAdapter` and `KickPlugin`.
 */
export type IntrospectFn = () => IntrospectionSnapshot | Promise<IntrospectionSnapshot>
