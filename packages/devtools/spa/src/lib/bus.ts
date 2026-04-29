// Browser bus singleton + recent-events ring buffer.
//
// The activity-log tab and any future bus consumer (slow-query
// notifier, real-time topology refresher, etc.) share a single
// `createBrowserBus()` instance — opening one WebSocket per tab would
// burn a server connection slot for every tab the user clicks.
//
// We start collecting events as soon as `bootBus()` runs (called from
// App.tsx onMount), not on first tab-activate, so the log captures
// events emitted before the user opens the tab. The buffer is capped
// to bound memory: when full, oldest events are evicted FIFO.
//
// The auth token comes from the shared rpc helper so the WS upgrade
// authenticates the same way HTTP RPCs do.

import { createSignal, type Accessor } from 'solid-js'
import {
  createBrowserBus,
  type KickDevtoolsEvent,
  type KickEventBus,
} from '@forinda/kickjs-devtools-kit/bus'
import { getBasePath, getToken } from './rpc'

/** Soft cap on the in-memory log. Old events evict FIFO once exceeded. */
export const ACTIVITY_BUFFER_CAP = 500

let busInstance: KickEventBus | null = null
const [recentEvents, setRecentEvents] = createSignal<KickDevtoolsEvent[]>([])

/**
 * Boot the singleton bus + start collecting events into the recent-
 * events buffer. Idempotent — repeated calls return the same instance
 * and don't duplicate the wildcard subscription.
 *
 * Returns a cleanup function App.tsx can wire into `onCleanup` so dev
 * mode HMR doesn't leak listeners.
 */
export function bootBus(): () => void {
  if (busInstance) return () => {}

  const wsPath = `${getBasePath()}/_bus`
  // Build absolute ws:// or wss:// URL from the current location.
  // SAfari rejects relative ws URLs; explicit construction sidesteps
  // every browser's quirks here.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getToken()
  const tokenSuffix = token ? `?token=${encodeURIComponent(token)}` : ''
  const wsUrl = `${proto}//${location.host}${wsPath}${tokenSuffix}`

  busInstance = createBrowserBus({
    channel: 'kick-devtools',
    wsUrl,
  })

  const off = busInstance.onAny((event) => {
    setRecentEvents((prev) => {
      const next = prev.length >= ACTIVITY_BUFFER_CAP ? prev.slice(1) : prev.slice()
      next.push(event)
      return next
    })
  })

  return () => {
    off()
    busInstance = null
    setRecentEvents([])
  }
}

/** Reactive accessor for the activity log feed. */
export function recentBusEvents(): Accessor<KickDevtoolsEvent[]> {
  return recentEvents
}

/** Imperative clear — the activity-log tab's "Clear" button calls this. */
export function clearRecentEvents(): void {
  setRecentEvents([])
}

/**
 * Imperative bus access — the activity-log tab uses this for emit()
 * (so the user can manually drop a synthetic event for testing) and
 * future tabs that publish their own events will too.
 */
export function getBus(): KickEventBus | null {
  return busInstance
}
