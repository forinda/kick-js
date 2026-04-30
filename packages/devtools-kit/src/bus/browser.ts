// Browser KickEventBus — wraps the bus core with two optional
// transports:
//
//   - **BroadcastChannel** for cross-tab fan-out. When DevTools opens
//     in two browser tabs against the same project, an event emitted
//     in one shows up in both. Same-origin only — anything stricter
//     would require a SharedWorker, which is overkill.
//
//   - **WebSocket** to receive server-emitted events (slow queries,
//     migration events) from the kick/devtools server bus. The client
//     auto-reconnects with bounded backoff so a brief network blip
//     during dev doesn't permanently silence the activity log.
//
// Both transports are optional — pass nothing and you get a single-tab
// bus that's still useful for in-page event flow.
//
// Loop avoidance:
//   - Events received over BroadcastChannel or WebSocket are dispatched
//     to local subscribers via `core.dispatch(envelope)`. They are NOT
//     re-broadcast — only `emit()` from local code triggers transport
//     fan-out. Without this rule, two open tabs would echo every event
//     back at each other forever.
//   - The wire envelope includes a `__kick_origin` marker so receivers
//     can tell remote events from local ones. Tabs that want to filter
//     remote noise can branch on it via `onAny()`.

import { createBusCore } from './in-memory'
import type { KickDevtoolsEvent, KickEventBus, Unsubscribe } from './types'

export interface BrowserBusOptions {
  /** BroadcastChannel name. Default `'kick-devtools'`. Pass `false` to disable. */
  channel?: string | false
  /**
   * WebSocket URL pointing at the server bus. When set, the bus opens
   * a connection on first subscription/emit and forwards every message
   * into the local dispatcher. Leave undefined to skip WS entirely.
   */
  wsUrl?: string
  /**
   * Reconnect backoff in ms. Bus retries at `attempt * delayMs`,
   * capped at `maxDelayMs`. Defaults: 500ms / 5000ms.
   */
  reconnectMs?: number
  reconnectMaxMs?: number
}

interface TaggedEnvelope extends KickDevtoolsEvent {
  __kick_origin?: 'local' | 'broadcast' | 'ws'
}

export function createBrowserBus(opts: BrowserBusOptions = {}): KickEventBus {
  const core = createBusCore()

  const channelName = opts.channel === false ? null : (opts.channel ?? 'kick-devtools')
  const channel: BroadcastChannel | null =
    channelName != null && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(channelName)
      : null

  channel?.addEventListener('message', (msg: MessageEvent) => {
    const data = msg.data as TaggedEnvelope | null
    if (!data || typeof data.type !== 'string' || typeof data.ts !== 'number') return
    core.dispatch({ ...data, __kick_origin: 'broadcast' } as KickDevtoolsEvent)
  })

  let socket: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const reconnectMs = opts.reconnectMs ?? 500
  const reconnectMaxMs = opts.reconnectMaxMs ?? 5000

  const connect = (): void => {
    if (!opts.wsUrl) return
    if (typeof WebSocket === 'undefined') return
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    socket = new WebSocket(opts.wsUrl)
    socket.addEventListener('open', () => {
      reconnectAttempt = 0
    })
    socket.addEventListener('message', (msg: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(msg.data)) as TaggedEnvelope
        if (!parsed || typeof parsed.type !== 'string' || typeof parsed.ts !== 'number') return
        core.dispatch({ ...parsed, __kick_origin: 'ws' } as KickDevtoolsEvent)
      } catch {
        // Malformed payload — drop it. The server shouldn't send
        // non-JSON, but a corrupted frame shouldn't crash the bus.
      }
    })
    socket.addEventListener('close', () => {
      socket = null
      scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      // Errors close the socket too, but be defensive — schedule a
      // retry even if 'close' doesn't fire.
      scheduleReconnect()
    })
  }

  const scheduleReconnect = (): void => {
    if (!opts.wsUrl) return
    if (reconnectTimer != null) return
    reconnectAttempt += 1
    const delay = Math.min(reconnectAttempt * reconnectMs, reconnectMaxMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const broadcast = (event: TaggedEnvelope): void => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage takes only one argument; targetOrigin is for Window.postMessage
    channel?.postMessage(event)
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event))
    } else if (opts.wsUrl) {
      // Lazy-connect on first emit when the URL is set but we haven't
      // opened the socket yet (subscription-first vs emit-first race).
      connect()
    }
  }

  return {
    on(type: string, handler: (payload: unknown) => void): Unsubscribe {
      // Lazy-connect on first subscription — most consumers subscribe
      // up front, so this is the natural trigger to open the socket.
      connect()
      return core.on(type, handler)
    },
    onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe {
      connect()
      return core.onAny(handler)
    },
    emit(type: string, payload: unknown): void {
      const envelope: TaggedEnvelope = {
        type,
        payload,
        ts: Date.now(),
        __kick_origin: 'local',
      }
      core.dispatch(envelope)
      broadcast(envelope)
    },
  } as KickEventBus
}
