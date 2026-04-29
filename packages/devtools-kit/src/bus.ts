/**
 * Bus sub-entry — pulled in by code that participates in the runtime
 * event-bus pipeline (the server-side bus, plugins publishing typed
 * events, the DI token consumers grab to inject the bus). Lives at a
 * separate sub-path so pure-browser consumers of `./types` and
 * `./runtime` don't pay the `@forinda/kickjs` peer-dep cost via the
 * `createToken` import inside `./bus/token`.
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
export { DEVTOOLS_BUS } from './bus/token'
