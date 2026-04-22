/**
 * Transport-agnostic execution context primitives.
 *
 * `ExecutionContext` is the minimal contract every transport-specific
 * context object satisfies — `RequestContext` (HTTP) implements it today;
 * `WsContext`, `QueueContext`, and `CronContext` will adopt it in V2.
 *
 * `ContextMeta` is the augmentable per-request key/type registry. Apps and
 * plugins extend it via module augmentation to get type-safe `ctx.get/set`
 * across the codebase. It lives in core/ (not http/) so non-HTTP transports
 * share a single declaration site.
 *
 * @example
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface ContextMeta {
 *     user: { id: string; email: string }
 *     tenant: { id: string; name: string }
 *   }
 * }
 *
 * function loadProject(ctx: ExecutionContext) {
 *   const user = ctx.get('user')   // typed: { id: string; email: string } | undefined
 * }
 * ```
 */

/**
 * Augmentable per-request metadata registry.
 *
 * Extend via module augmentation to give `ctx.get()` / `ctx.set()` static
 * type information for a given key. Unknown keys still resolve via an
 * explicit generic: `ctx.get<MyType>('custom')`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ContextMeta {}

/** Resolve a {@link ContextMeta} value type, falling back to `Fallback` for unknown keys. */
export type MetaValue<K extends string, Fallback = unknown> = K extends keyof ContextMeta
  ? ContextMeta[K]
  : Fallback

/**
 * Minimal transport-agnostic execution context.
 *
 * `RequestContext` (HTTP) implements this directly; future `WsContext`,
 * `QueueContext`, and `CronContext` (V2) will too. The Context Contributor
 * pipeline only depends on this interface — contributors authored against
 * `ExecutionContext` work across every transport that adopts it.
 */
export interface ExecutionContext {
  /** Read a typed value from per-request metadata. */
  get<K extends string>(key: K): MetaValue<K> | undefined
  /** Write a typed value into per-request metadata. */
  set<K extends string>(key: K, value: MetaValue<K>): void
  /** Unique per-request identifier (HTTP: x-request-id; WS/queue/cron: transport-defined). */
  readonly requestId: string | undefined
}
