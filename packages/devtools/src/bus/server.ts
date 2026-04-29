// Server-side KickEventBus implementation.
//
// Wraps the bus core from `@forinda/kickjs-devtools-kit/bus` with a
// `ws` server bound to a path on the framework's existing
// `http.Server`. Architecture:
//
//   server.on('upgrade')   ─┐
//                            ├──► WebSocketServer.handleUpgrade()
//                            │     └─► ws clients: receive emits as JSON
//   bus.emit(type, payload) ─┴──►  serialize → fan out to clients +
//                                  dispatch locally to in-process subs
//
// Why piggyback on the framework's http.Server instead of starting a
// dedicated WS server: the framework already owns the listener, the
// upgrade event is the canonical hook, and reusing it means devtools
// inherits whatever TLS / proxy / port config the application provides.
//
// Lifecycle:
//   - createServerBus() builds the WebSocketServer in `noServer: true`
//     mode (no listener of its own) and returns the bus + attach/close
//     handles.
//   - attachUpgrade(httpServer) wires server.on('upgrade') so upgrades
//     matching `wsPath` route into the WebSocketServer. Other upgrade
//     paths (kickjs-ws, etc.) ignore us by virtue of path matching.
//   - close() drops every client and detaches from the http server so
//     repeated dev-mode restarts don't leak listener handles.
//
// Authentication:
//   - The optional `secret` matches the devtools panel's existing
//     `x-devtools-token` / `?token=` access guard. When set, upgrades
//     without the right token get rejected at HTTP-handshake time —
//     never reaching the bus.
//
// Loop avoidance:
//   - Server emits fan out to every connected client. Client-side
//     emits sent UP the socket dispatch into the local core (so
//     server tabs can react) but are NOT re-broadcast to other
//     clients. This keeps the same "no echo" contract the browser
//     bus enforces; without it a tab's emit would round-trip through
//     the server and back to itself.

import type { IncomingMessage } from 'node:http'
import type http from 'node:http'
import type { Socket } from 'node:net'

import { createBusCore } from '@forinda/kickjs-devtools-kit/bus'
import type { KickDevtoolsEvent, KickEventBus, Unsubscribe } from '@forinda/kickjs-devtools-kit/bus'
import { WebSocketServer, type WebSocket } from 'ws'

export interface ServerBusOptions {
  /** Path the WebSocket upgrade listens on. Default `/_debug/_bus`. */
  wsPath?: string
  /**
   * Optional shared secret. When set, clients must include either
   * `?token=<secret>` on the upgrade URL or an
   * `x-devtools-token: <secret>` header. Unauthorized upgrades return
   * 401 and never reach the bus. Pass `false` (or omit) to disable.
   */
  secret?: string | false
}

interface TaggedEnvelope extends KickDevtoolsEvent {
  __kick_origin?: 'local' | 'broadcast' | 'ws'
}

export interface ServerBus extends KickEventBus {
  /** Hook into an existing http.Server's `upgrade` event. */
  attachUpgrade(httpServer: http.Server): void
  /** Drop all clients + detach. Idempotent. */
  close(): void
  /** Currently connected client count. Useful for the devtools health card. */
  clientCount(): number
}

export function createServerBus(opts: ServerBusOptions = {}): ServerBus {
  const wsPath = opts.wsPath ?? '/_debug/_bus'
  const secret = opts.secret ?? false
  const core = createBusCore()
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()
  let attachedServer: http.Server | null = null
  let upgradeHandler: ((req: IncomingMessage, socket: Socket, head: Buffer) => void) | null = null

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8')
        const parsed = JSON.parse(text) as TaggedEnvelope
        if (!parsed || typeof parsed.type !== 'string' || typeof parsed.ts !== 'number') return
        // Dispatch locally only — never echo back to other clients.
        // (Tabs that need cross-tab fan-out use BroadcastChannel; the
        // server is point-to-point per client.)
        core.dispatch({ ...parsed, __kick_origin: 'ws' } as KickDevtoolsEvent)
      } catch {
        // Malformed — drop silently. A misbehaving tab shouldn't
        // crash the server bus.
      }
    })
    ws.on('close', () => {
      clients.delete(ws)
    })
    ws.on('error', () => {
      clients.delete(ws)
    })
  })

  const fanOut = (envelope: TaggedEnvelope): void => {
    if (clients.size === 0) return
    const text = JSON.stringify(envelope)
    for (const client of clients) {
      // OPEN === 1 in the ws spec; reusing the import for the type
      // guard keeps this readable without pulling in WebSocket consts.
      if (client.readyState === client.OPEN) {
        try {
          client.send(text)
        } catch {
          // Network error mid-fan-out — clean removal happens via the
          // 'close' / 'error' handlers; nothing to do here.
        }
      }
    }
  }

  const checkAuth = (req: IncomingMessage): boolean => {
    if (secret === false) return true
    const header = req.headers['x-devtools-token']
    if (typeof header === 'string' && header === secret) return true
    // Parse query — `req.url` is path + ?query for upgrade requests.
    const url = req.url ?? ''
    const queryIdx = url.indexOf('?')
    if (queryIdx === -1) return false
    const params = new URLSearchParams(url.slice(queryIdx + 1))
    return params.get('token') === secret
  }

  const attachUpgrade = (httpServer: http.Server): void => {
    if (attachedServer) return // idempotent
    attachedServer = httpServer
    upgradeHandler = (req, socket, head) => {
      // Path match — ignore upgrades destined for other adapters
      // (kickjs-ws, custom adapters, etc.). They register their own
      // upgrade handlers; ours just no-ops on non-matching URLs.
      const url = req.url ?? ''
      const pathOnly = url.split('?')[0]
      if (pathOnly !== wsPath) return

      if (!checkAuth(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, req)
      })
    }
    httpServer.on('upgrade', upgradeHandler)
  }

  const close = (): void => {
    if (attachedServer && upgradeHandler) {
      attachedServer.off('upgrade', upgradeHandler)
    }
    attachedServer = null
    upgradeHandler = null
    for (const client of clients) {
      try {
        client.close()
      } catch {
        // ignore
      }
    }
    clients.clear()
    wss.close()
  }

  return {
    on(type: string, handler: (payload: unknown) => void): Unsubscribe {
      return core.on(type, handler)
    },
    onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe {
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
      fanOut(envelope)
    },
    attachUpgrade,
    close,
    clientCount: () => clients.size,
  } as ServerBus
}
