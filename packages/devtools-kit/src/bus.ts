/**
 * Bus sub-entry — pulled in by browser SPA + server-side bus
 * publishers alike. Re-exports types + the in-memory / browser bus
 * implementations.
 *
 * The DI token (`DEVTOOLS_BUS`) is intentionally NOT re-exported
 * here because importing it pulls `createToken` from
 * `@forinda/kickjs` — and through it the entire framework runtime
 * (Express + body-parser + …) into any consumer that touches this
 * sub-path. Browser SPAs that imported from `./bus` were getting
 * 1MB+ of polyfilled server code in their bundle.
 *
 * Server-side consumers grab the token from the dedicated
 * `@forinda/kickjs-devtools-kit/bus/token` sub-path, which stays
 * outside the browser SPA's import graph.
 *
 * @module @forinda/kickjs-devtools-kit/bus
 */

export type {
  KickEventBus,
  KickDevtoolsEvent,
  KickDevtoolsEventName,
  KickDevtoolsEventRegistry,
  EventTypeKey,
  EventPayload,
  Unsubscribe,
} from './bus/types'

export { createInMemoryBus, createBusCore, type BusCore } from './bus/in-memory'
export { createBrowserBus, type BrowserBusOptions } from './bus/browser'
