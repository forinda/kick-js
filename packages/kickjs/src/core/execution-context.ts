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
 * Augmentable per-request **value-type** registry.
 *
 * Extend via module augmentation to give `ctx.get()` / `ctx.set()` static
 * type information for a given key. Unknown keys still resolve via an
 * explicit generic: `ctx.get<MyType>('custom')`.
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface ContextMeta {
 *     tenant: { id: string; name: string }
 *   }
 * }
 * ```
 *
 * Every key declared here is automatically a valid `dependsOn` key — see
 * {@link ContextKeys} for the relationship.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ContextMeta {}

/**
 * Augmentable per-request **key** registry — the set of context keys a
 * project's contributors populate, independent of whether each key has a
 * declared value type in {@link ContextMeta}.
 *
 * This exists so `dependsOn` (and any other key-level typing) can be
 * narrowed to real keys WITHOUT forcing every key to carry a value type.
 * Before it, `dependsOn` was typed against `keyof ContextMeta` alone, so
 * the moment a project augmented `ContextMeta` for *some* keys, any
 * contributor that depended on a key you hadn't added to `ContextMeta`
 * stopped compiling — even though that key was a perfectly valid
 * contributor. Splitting the two registries removes that coupling:
 *
 * - Put a key in `ContextMeta` when you want `ctx.get(key)` typed.
 * - Put a key in `ContextKeys` when it's a real contributor key but you
 *   don't need a value type for it (e.g. a marker, or a value you only
 *   ever read with an explicit generic).
 *
 * Keys from BOTH registries are accepted by `dependsOn`, so adding a
 * value type via `ContextMeta` never breaks a `dependsOn` elsewhere.
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface ContextKeys {
 *     session: true       // value type irrelevant; the key just exists
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ContextKeys {}

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
  /**
   * Read a value that must be present, throwing `MissingContextValueError`
   * when it isn't. Use for preconditions (permissions, tenant, resolved
   * subject) where `get(key)!` would silently paper over a contributor
   * that never ran. Only `undefined` throws — `null` is a real value.
   */
  require<K extends string>(key: K): NonNullable<MetaValue<K>>
  /** Write a typed value into per-request metadata. */
  set<K extends string>(key: K, value: MetaValue<K>): void
  /** Unique per-request identifier (HTTP: x-request-id; WS/queue/cron: transport-defined). */
  readonly requestId: string | undefined
}
