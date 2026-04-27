// KickEventBus placeholder — M2.D will replace this with the typed
// browser/server implementation. Until then, the type lives here so
// the M2.C tab contract can reference it without circular package
// dependencies. The minimal shape covers the subscription pattern
// every M2.C-migrated tab will use:
//
//   props.bus.on('event:name', handler) → unsubscribe fn
//
// M2.D will tighten:
//   - typed event registry (KickDevtoolsEvent → discriminated union)
//   - emit() surface for tab-side broadcasts
//   - server-bridge fan-out
//
// Adopters wiring tabs against this placeholder will recompile under
// M2.D without source changes — the surface only widens.

/** Generic event key — M2.D narrows to a typed discriminated union. */
export type KickDevtoolsEventName = string

/** Unsubscribe function returned from `bus.on()`. */
export type Unsubscribe = () => void

/**
 * Minimal event bus surface — M2.C tab `render()` callbacks use this
 * to subscribe to runtime events (slow queries, route hits, etc.).
 *
 * `Payload = unknown` placeholder until M2.D supplies the typed event
 * registry. Tab authors who need stronger types today can intersect
 * `KickEventBus` with their own typed `on<E extends keyof MyEvents>`
 * overload as a transitional shim.
 */
export interface KickEventBus {
  on(event: KickDevtoolsEventName, handler: (payload: unknown) => void): Unsubscribe
  off?(event: KickDevtoolsEventName, handler: (payload: unknown) => void): void
  emit?(event: KickDevtoolsEventName, payload: unknown): void
}
