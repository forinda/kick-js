// KickEventBus — the runtime event bus DevTools tabs subscribe to.
//
// Two surfaces in one interface:
//
//   - `on(type, handler)` / `emit(type, payload)` — the simple
//     payload-only path. M2.C tabs already use this; signature stays
//     stable so existing adopters recompile cleanly under M2.D.
//
//   - `onAny(handler)` — wildcard subscription. Receives the full
//     `KickDevtoolsEvent` envelope so the activity-log tab (and any
//     future cross-cutting consumer) can read `type`, `pluginId`,
//     `ts` alongside the payload.
//
// Adopters get type-safe `on` / `emit` for events they declare via
// `KickDevtoolsEventRegistry` interface augmentation:
//
//   declare module '@forinda/kickjs-devtools-kit' {
//     interface KickDevtoolsEventRegistry {
//       'db:slow-query': { sql: string; durationMs: number }
//     }
//   }
//
//   bus.on('db:slow-query', (q) => { /* q.sql + q.durationMs are typed */ })
//   bus.emit('db:slow-query', { sql: '...', durationMs: 120 })
//
// Events that aren't in the registry still work — they fall back to
// the string overload with `payload: unknown`. So adopters can publish
// custom events from their own tabs without forcing a type module.

/** Generic event key — adopters narrow via registry augmentation. */
export type KickDevtoolsEventName = string

/** Unsubscribe function returned from `bus.on()` / `bus.onAny()`. */
export type Unsubscribe = () => void

/**
 * Registry of typed events keyed by event name. Empty by default —
 * each first-party plugin (kickjs-db, kickjs-queue, etc.) augments
 * this interface to type-tag the events it publishes.
 *
 * @example
 * ```ts
 * declare module '@forinda/kickjs-devtools-kit' {
 *   interface KickDevtoolsEventRegistry {
 *     'db:slow-query': { sql: string; parameters: unknown[]; durationMs: number }
 *   }
 * }
 * ```
 */
// Empty by design — adopters augment via declaration merging.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KickDevtoolsEventRegistry {}

export type EventTypeKey = keyof KickDevtoolsEventRegistry & string
export type EventPayload<K extends EventTypeKey> = KickDevtoolsEventRegistry[K]

/**
 * Envelope wrapping each emitted event. `on()` subscribers see only
 * `payload`; `onAny()` subscribers see this whole shape.
 */
export interface KickDevtoolsEvent<T = unknown> {
  /** Event name — registered via `KickDevtoolsEventRegistry` for type safety. */
  type: string
  /** Adopter-supplied payload. */
  payload: T
  /** Optional plugin/adapter origin tag (`'kick/db'`, `'kick/queue'`, etc.). */
  pluginId?: string
  /** Emission timestamp (epoch ms). The bus stamps this on every emit. */
  ts: number
}

/**
 * The bus surface every tab and emitter touches. Implementations
 * (in-memory, browser, server) all conform to this shape so consumers
 * stay portable across runtimes.
 */
export interface KickEventBus {
  /** Subscribe to a typed event from the registry. Returns unsubscribe. */
  on<K extends EventTypeKey>(type: K, handler: (payload: EventPayload<K>) => void): Unsubscribe
  /** Subscribe to an arbitrary event name. Payload typed as `unknown`. */
  on(type: string, handler: (payload: unknown) => void): Unsubscribe

  /** Emit a typed event from the registry. */
  emit<K extends EventTypeKey>(type: K, payload: EventPayload<K>): void
  /** Emit an arbitrary event name. */
  emit(type: string, payload: unknown): void

  /**
   * Wildcard subscription — every emitted event passes through, with
   * the full envelope (`type`, `payload`, `ts`, optional `pluginId`).
   * The activity-log tab uses this; per-event subscribers should stick
   * to `on()` so the registry types stay tight.
   */
  onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe
}
