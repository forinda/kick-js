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
// its adapter's `beforeStart` so anything resolved during plugin boot
// can grab it. Plugins that resolve before devtools boots get
// `undefined`; making the dep optional via `@Optional()` is the
// idiomatic guard.

import { createToken, type InjectionToken } from '@forinda/kickjs'

import type { KickEventBus } from './types'

/** Server-side runtime event bus published by the devtools adapter. */
export const DEVTOOLS_BUS: InjectionToken<KickEventBus> =
  createToken<KickEventBus>('kick/devtools/bus')
