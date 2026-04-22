import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  defineAdapter,
  type Container,
  createLogger,
  ref,
  type Ref,
  getClassMetaOrUndefined,
  getClassMeta,
} from '@forinda/kickjs'
import {
  WS_ADAPTER,
  WS_METADATA,
  WS_ROOM_MANAGER,
  WS_USER_BROADCASTER,
  wsControllerRegistry,
  type WsAdapterOptions,
  type WsHandlerDefinition,
  type WsUserBroadcaster,
} from './interfaces'
import { WsContext } from './ws-context'
import { RoomManager } from './room-manager'

const log = createLogger('WsAdapter')

interface NamespaceEntry {
  namespace: string
  controllerClass: any
  handlers: WsHandlerDefinition[]
  sockets: Map<string, WebSocket>
  contexts: Map<string, WsContext>
}

/**
 * Public extension methods exposed by a WsAdapter instance — broadcast
 * helpers, namespace stats, and reactive counters that DevTools and
 * other adapters consume directly.
 */
export interface WsAdapterExtensions {
  /** Snapshot of WebSocket stats — consumed by DevTools / Swagger ws-server discovery. */
  getStats(): {
    totalConnections: number
    activeConnections: number
    messagesReceived: number
    messagesSent: number
    errors: number
    namespaces: Record<string, { connections: number; handlers: number }>
    rooms: ReturnType<RoomManager['getAllRooms']>
  }
  /** Room name used for per-user broadcasting. */
  userRoom(userId: string): string
  /** Broadcast a single event to every socket in `user:<id>` (across namespaces). */
  broadcastToUser(userId: string, event: string, data: unknown): void
  /** Total WebSocket connections ever opened. */
  readonly totalConnections: Ref<number>
  /** Currently active connections. */
  readonly activeConnections: Ref<number>
  /** Total messages received. */
  readonly messagesReceived: Ref<number>
  /** Total messages sent. */
  readonly messagesSent: Ref<number>
  /** Total errors. */
  readonly wsErrors: Ref<number>
}

/**
 * WebSocket adapter for KickJS. Attaches to the HTTP server and routes
 * WebSocket connections to @WsController classes based on namespace paths.
 *
 * @example
 * ```ts
 * import { WsAdapter } from '@forinda/kickjs-ws'
 *
 * bootstrap({
 *   modules: [ChatModule],
 *   adapters: [
 *     WsAdapter({ path: '/ws' }),
 *   ],
 * })
 * ```
 *
 * Clients connect to: `ws://localhost:3000/ws/chat`
 * Messages are JSON: `{ "event": "send", "data": { "text": "hello" } }`
 */
export const WsAdapter = defineAdapter<WsAdapterOptions, WsAdapterExtensions>({
  name: 'WsAdapter',
  defaults: {
    path: '/ws',
    heartbeatInterval: 30000,
  },
  build: (options) => {
    const basePath = options.path!
    const heartbeatInterval = options.heartbeatInterval!
    const maxPayload = options.maxPayload
    const auth = options.auth
    const userRoomPrefix = options.auth?.userRoomPrefix ?? 'user:'

    let wss: WebSocketServer | null = null
    let container: Container | null = null
    const namespaces = new Map<string, NamespaceEntry>()
    const roomManager = new RoomManager()
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const totalConnections = ref(0)
    const activeConnections = ref(0)
    const messagesReceived = ref(0)
    const messagesSent = ref(0)
    const wsErrors = ref(0)

    const userRoom = (userId: string): string => userRoomPrefix + userId

    const broadcastToUser = (userId: string, event: string, data: unknown): void => {
      roomManager.broadcast(userRoom(userId), event, data)
    }

    const buildUserBroadcaster = (): WsUserBroadcaster => ({
      roomFor: (id) => userRoom(id),
      broadcastToUser: (id, event, data) => broadcastToUser(id, event, data),
      toUser: (id) => ({
        send: (event, data) => broadcastToUser(id, event, data),
      }),
    })

    const getStats = () => {
      const namespaceStats: Record<string, { connections: number; handlers: number }> = {}
      for (const [path, entry] of namespaces) {
        namespaceStats[path] = {
          connections: entry.sockets.size,
          handlers: entry.handlers.length,
        }
      }
      return {
        totalConnections: totalConnections.value,
        activeConnections: activeConnections.value,
        messagesReceived: messagesReceived.value,
        messagesSent: messagesSent.value,
        errors: wsErrors.value,
        namespaces: namespaceStats,
        rooms: roomManager.getAllRooms(),
      }
    }

    const safeInvoke = (controller: any, method: string, ctx: WsContext): void => {
      try {
        const result = controller[method](ctx)
        if (result instanceof Promise) {
          result.catch((err: Error) => {
            log.error({ err }, `WS handler error in ${method}`)
          })
        }
      } catch (err) {
        log.error({ err }, `WS handler error in ${method}`)
      }
    }

    const invokeHandlers = (
      controller: any,
      handlers: WsHandlerDefinition[],
      type: WsHandlerDefinition['type'],
      ctx: WsContext,
    ): void => {
      for (const handler of handlers) {
        if (handler.type === type) {
          safeInvoke(controller, handler.handlerName, ctx)
        }
      }
    }

    /**
     * Runs the configured auth hook against the upgrade request. Stashes the
     * resolved user on the context (as `user`, plus mirrored keys) and, when
     * `autoJoinUserRoom` is enabled, joins the socket to `user:<id>`.
     * Returns `false` (and closes the socket with code 4401) on failure.
     */
    const authenticate = async (ctx: WsContext): Promise<boolean> => {
      if (!auth) return true
      try {
        const user = await auth.resolveUser(ctx.request)
        if (!user || !user.id) {
          ctx.socket.close(4401, 'Unauthorized')
          return false
        }
        ctx.set('user', user)
        ctx.set('userId', user.id)
        if (auth.autoJoinUserRoom !== false) {
          ctx.join(userRoom(user.id))
        }
        return true
      } catch (err) {
        log.warn('WS auth failed', err)
        ctx.socket.close(4401, 'Unauthorized')
        return false
      }
    }

    const handleConnection = (
      ws: WebSocket,
      entry: NamespaceEntry,
      request: IncomingMessage,
    ): void => {
      const socketId = randomUUID()
      ;(ws as any).__alive = true

      entry.sockets.set(socketId, ws)
      totalConnections.value++
      activeConnections.value++

      const ctx = new WsContext(
        ws,
        wss!,
        roomManager,
        entry.sockets,
        socketId,
        entry.namespace,
        request,
      )
      entry.contexts.set(socketId, ctx)

      const controller = container!.resolve(entry.controllerClass)

      ws.on('pong', () => {
        ;(ws as any).__alive = true
      })

      // Authenticated handshake (optional). Messages received before auth
      // resolves are buffered on the socket; we gate dispatch on `authed`.
      let authed = auth === undefined
      const authPromise = auth ? authenticate(ctx) : Promise.resolve(true)

      authPromise.then((ok) => {
        if (!ok) return
        authed = true
        invokeHandlers(controller, entry.handlers, 'connect', ctx)
      })

      ws.on('message', (raw: Buffer | string) => {
        if (!authed) return
        messagesReceived.value++
        try {
          const parsed = JSON.parse(raw.toString())
          const event = parsed.event as string
          const data = parsed.data

          if (!event || typeof event !== 'string') {
            ctx.send('error', { message: 'Invalid message format: missing "event" field' })
            return
          }

          ctx.event = event
          ctx.data = data

          const handler = entry.handlers.find((h) => h.type === 'message' && h.event === event)

          if (handler) {
            safeInvoke(controller, handler.handlerName, ctx)
          } else {
            const catchAll = entry.handlers.find((h) => h.type === 'message' && h.event === '*')
            if (catchAll) {
              safeInvoke(controller, catchAll.handlerName, ctx)
            }
          }
        } catch {
          ctx.data = { message: 'Invalid JSON' }
          invokeHandlers(controller, entry.handlers, 'error', ctx)
        }
      })

      ws.on('close', () => {
        activeConnections.value--
        invokeHandlers(controller, entry.handlers, 'disconnect', ctx)
        roomManager.leaveAll(socketId)
        entry.sockets.delete(socketId)
        entry.contexts.delete(socketId)
      })

      ws.on('error', (err: Error) => {
        wsErrors.value++
        ctx.data = { message: err.message, name: err.name }
        invokeHandlers(controller, entry.handlers, 'error', ctx)
      })
    }

    return {
      getStats,
      userRoom,
      broadcastToUser,
      totalConnections,
      activeConnections,
      messagesReceived,
      messagesSent,
      wsErrors,

      beforeStart({ container: containerArg }) {
        container = containerArg

        // The factory's mutate-name pattern means `this` inside lifecycle
        // hooks does not reach the returned adapter object; pass the
        // adapter itself via WS_ADAPTER for code that wants the full
        // surface (broadcast helpers, stats, refs).
        // We don't have a `this` reference for the WS_ADAPTER token, so
        // we rebuild the externally-visible surface inline here.
        container.registerInstance(WS_ADAPTER, {
          getStats,
          userRoom,
          broadcastToUser,
          totalConnections,
          activeConnections,
          messagesReceived,
          messagesSent,
          wsErrors,
        })
        container.registerInstance(WS_ROOM_MANAGER, roomManager)
        container.registerInstance(WS_USER_BROADCASTER, buildUserBroadcaster())

        // Discover all @WsController classes and build routing table
        for (const controllerClass of wsControllerRegistry) {
          const namespace = getClassMetaOrUndefined<string>(
            WS_METADATA.WS_CONTROLLER,
            controllerClass,
          )
          if (namespace === undefined) continue

          const handlers = getClassMeta<WsHandlerDefinition[]>(
            WS_METADATA.WS_HANDLERS,
            controllerClass,
            [],
          )

          const fullPath = basePath + (namespace === '/' ? '' : namespace)

          namespaces.set(fullPath, {
            namespace,
            controllerClass,
            handlers,
            sockets: new Map(),
            contexts: new Map(),
          })

          log.info(`Registered WS namespace: ${fullPath} (${controllerClass.name})`)
        }
      },

      afterStart({ server }) {
        if (!server) return

        wss = new WebSocketServer({
          noServer: true,
          maxPayload,
        })

        // Handle upgrade requests — route to correct namespace
        server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          const url = request.url || '/'
          // Parse pathname without relying on host header
          const pathname = url.split('?')[0]

          const entry = namespaces.get(pathname)
          if (!entry) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
            socket.destroy()
            return
          }

          wss!.handleUpgrade(request, socket, head, (ws) => {
            handleConnection(ws, entry, request)
          })
        })

        // Heartbeat ping/pong
        if (heartbeatInterval > 0) {
          heartbeatTimer = setInterval(() => {
            for (const [, entry] of namespaces) {
              for (const [, socket] of entry.sockets) {
                if ((socket as any).__alive === false) {
                  socket.terminate()
                  continue
                }
                ;(socket as any).__alive = false
                socket.ping()
              }
            }
          }, heartbeatInterval)
        }

        const totalHandlers = Array.from(namespaces.values()).reduce(
          (sum, e) => sum + e.handlers.length,
          0,
        )
        log.info(`WebSocket ready — ${namespaces.size} namespace(s), ${totalHandlers} handler(s)`)
      },

      shutdown() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
        }

        // Close all connections
        for (const [, entry] of namespaces) {
          for (const [, socket] of entry.sockets) {
            socket.close(1001, 'Server shutting down')
          }
          entry.sockets.clear()
          entry.contexts.clear()
        }

        wss?.close()
      },
    }
  },
})
