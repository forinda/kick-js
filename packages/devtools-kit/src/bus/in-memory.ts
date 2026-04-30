// In-memory KickEventBus — no transport, just handler maps.
//
// This is the building block the browser + server buses wrap with
// transport (BroadcastChannel/WebSocket on the browser, EventEmitter +
// WebSocketServer on the Node side). It's also what tab unit tests
// instantiate when they want to assert subscription behavior without
// pulling in the DOM or a network shim.
//
// Public surface:
//   - `createInMemoryBus()` returns a `KickEventBus` whose `emit` stamps
//     a fresh envelope (ts = Date.now()) and dispatches synchronously.
//   - `createBusCore()` exposes the underlying primitives — `on`,
//     `onAny`, plus a `dispatch(envelope)` that takes a pre-formed
//     envelope. Transport-aware buses (browser, server) use this so
//     events received from the wire keep their original `ts` and
//     `pluginId` instead of getting re-stamped on local fan-out.
//
// Behavior:
//   - `on(type, handler)` and `onAny(handler)` register listeners
//     against an internal map; the returned `Unsubscribe` removes
//     exactly the registered handler (no false-double-removes if the
//     same fn is registered for multiple types).
//   - `dispatch(event)` synchronously calls every matching `on()`
//     handler with `event.payload`, then every `onAny()` handler with
//     the full envelope.
//   - Handler exceptions are caught and routed to `console.error` so a
//     misbehaving subscriber can't take out the bus or sibling tabs.
//   - Re-entrant emits (a handler emits a different event) are safe;
//     dispatch iterates a snapshot of the handler set.

import type { KickDevtoolsEvent, KickEventBus, Unsubscribe } from './types'

export interface BusCore {
  on(type: string, handler: (payload: unknown) => void): Unsubscribe
  onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe
  /** Dispatch a pre-built envelope; preserves the caller's `ts`/`pluginId`. */
  dispatch(event: KickDevtoolsEvent): void
}

export function createBusCore(): BusCore {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const anyHandlers = new Set<(event: KickDevtoolsEvent) => void>()

  const dispatch = (event: KickDevtoolsEvent): void => {
    // Snapshot so re-entrant subscribe/unsubscribe inside a handler
    // doesn't perturb the iteration we're already running.
    const targeted = handlers.get(event.type)
    if (targeted && targeted.size > 0) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- Set clone is intentional (re-entrant safety, see comment above)
      for (const handler of [...targeted]) {
        try {
          handler(event.payload)
        } catch (err) {
          console.error(`[kick:devtools-bus] handler for "${event.type}" threw`, err)
        }
      }
    }
    if (anyHandlers.size > 0) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- Set clone is intentional (re-entrant safety, see comment above)
      for (const handler of [...anyHandlers]) {
        try {
          handler(event)
        } catch (err) {
          console.error(`[kick:devtools-bus] onAny handler threw`, err)
        }
      }
    }
  }

  const on = (type: string, handler: (payload: unknown) => void): Unsubscribe => {
    let set = handlers.get(type)
    if (!set) {
      set = new Set()
      handlers.set(type, set)
    }
    set.add(handler)
    return () => {
      const current = handlers.get(type)
      current?.delete(handler)
      if (current && current.size === 0) handlers.delete(type)
    }
  }

  const onAny = (handler: (event: KickDevtoolsEvent) => void): Unsubscribe => {
    anyHandlers.add(handler)
    return () => {
      anyHandlers.delete(handler)
    }
  }

  return { on, onAny, dispatch }
}

export function createInMemoryBus(): KickEventBus {
  const core = createBusCore()
  return {
    on: core.on,
    onAny: core.onAny,
    emit: (type: string, payload: unknown) => {
      core.dispatch({ type, payload, ts: Date.now() })
    },
  } as KickEventBus
}
