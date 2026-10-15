// DI token for the server-side KickEventBus.
//
// First-party plugins (kickjs-db, kickjs-queue, future devtools-aware
// adapters) inject this to publish runtime events the DevTools panel
// consumes. The token lives in `@forinda/kickjs-devtools-kit` — the
// browser-friendly types package — so plugins can declare a typed
// dependency without pulling in the runtime devtools package (which
// owns the WebSocket transport + ws server lifecycle).
//
// `@forinda/kickjs-devtools` registers an instance under this token in
// its adapter's `beforeMount` so anything resolved during plugin boot
// can grab it. Before that, nothing is registered under the token, and
// resolving it throws: check `container.has(DEVTOOLS_BUS)` first, or use
// `getActiveDevtoolsBus()`.

import { createToken, type InjectionToken } from '@forinda/kickjs'

import type { KickEventBus } from './types'

/** Server-side runtime event bus published by the devtools adapter. */
export const DEVTOOLS_BUS: InjectionToken<KickEventBus> =
  createToken<KickEventBus>('kick/devtools/bus')

/**
 * Process-wide slot for the DevTools bus while the DevTools adapter runs, so
 * code that can't reach the container — a database client created at import
 * time — can still report to the panel. `Symbol.for` keeps the key shared
 * across module copies; kick/db reads it without importing this package.
 */
const ACTIVE_BUS = Symbol.for('kickjs.devtools.bus')

/** The DevTools bus while the DevTools adapter is running; `undefined` otherwise. */
export function getActiveDevtoolsBus(): KickEventBus | undefined {
  return (globalThis as Record<symbol, KickEventBus | undefined>)[ACTIVE_BUS]
}

/** Set (or with `undefined`, clear) the process-wide DevTools bus. Called by the DevTools adapter. */
export function setActiveDevtoolsBus(bus: KickEventBus | undefined): void {
  ;(globalThis as Record<symbol, KickEventBus | undefined>)[ACTIVE_BUS] = bus
}
