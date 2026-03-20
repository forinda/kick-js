import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { type AppAdapter, type Container, createLogger, ref, type Ref } from '@forinda/kickjs-core'
import {
  WS_METADATA,
  wsControllerRegistry,
  type WsAdapterOptions,
  type WsHandlerDefinition,
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
 *     new WsAdapter({ path: '/ws' }),
 *   ],
 * })
 * ```
 *
 * Clients connect to: `ws://localhost:3000/ws/chat`
 * Messages are JSON: `{ "event": "send", "data": { "text": "hello" } }`
 */
export class WsAdapter implements AppAdapter {
  readonly name = 'WsAdapter'

  private basePath: string
  private heartbeatInterval: number
  private maxPayload: number | undefined
  private wss: WebSocketServer | null = null
  private container: Container | null = null
  private namespaces = new Map<string, NamespaceEntry>()
  private roomManager = new RoomManager()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // ── Reactive Stats (exposed for DevToolsAdapter) ─────────────────────
  /** Total WebSocket connections ever opened */
  readonly totalConnections: Ref<number>
  /** Currently active connections */
  readonly activeConnections: Ref<number>
  /** Total messages received */
  readonly messagesReceived: Ref<number>
  /** Total messages sent */
  readonly messagesSent: Ref<number>
  /** Total errors */
  readonly wsErrors: Ref<number>

  constructor(options: WsAdapterOptions = {}) {
    this.basePath = options.path ?? '/ws'
    this.heartbeatInterval = options.heartbeatInterval ?? 30000
    this.maxPayload = options.maxPayload

    this.totalConnections = ref(0)
    this.activeConnections = ref(0)
    this.messagesReceived = ref(0)
    this.messagesSent = ref(0)
    this.wsErrors = ref(0)
  }

  /** Get a snapshot of WebSocket stats for DevTools */
  getStats() {
    const namespaceStats: Record<string, { connections: number; handlers: number }> = {}
    for (const [path, entry] of this.namespaces) {
      namespaceStats[path] = {
        connections: entry.sockets.size,
        handlers: entry.handlers.length,
      }
    }
    return {
      totalConnections: this.totalConnections.value,
      activeConnections: this.activeConnections.value,
      messagesReceived: this.messagesReceived.value,
      messagesSent: this.messagesSent.value,
      errors: this.wsErrors.value,
      namespaces: namespaceStats,
      rooms: this.roomManager.getAllRooms(),
    }
  }

  beforeStart(_app: any, container: Container): void {
    this.container = container

    // Discover all @WsController classes and build routing table
    for (const controllerClass of wsControllerRegistry) {
      const namespace: string | undefined = Reflect.getMetadata(
        WS_METADATA.WS_CONTROLLER,
        controllerClass,
      )
      if (namespace === undefined) continue

      const handlers: WsHandlerDefinition[] =
        Reflect.getMetadata(WS_METADATA.WS_HANDLERS, controllerClass) || []

      const fullPath = this.basePath + (namespace === '/' ? '' : namespace)

      this.namespaces.set(fullPath, {
        namespace,
        controllerClass,
        handlers,
        sockets: new Map(),
        contexts: new Map(),
      })

      log.info(`Registered WS namespace: ${fullPath} (${controllerClass.name})`)
    }
  }

  afterStart(server: any, _container: Container): void {
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxPayload,
    })

    // Handle upgrade requests — route to correct namespace
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = request.url || '/'
      // Parse pathname without relying on host header
      const pathname = url.split('?')[0]

      const entry = this.namespaces.get(pathname)
      if (!entry) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, entry)
      })
    })

    // Heartbeat ping/pong
    if (this.heartbeatInterval > 0) {
      this.heartbeatTimer = setInterval(() => {
        for (const [, entry] of this.namespaces) {
          for (const [, socket] of entry.sockets) {
            if ((socket as any).__alive === false) {
              socket.terminate()
              continue
            }
            ;(socket as any).__alive = false
            socket.ping()
          }
        }
      }, this.heartbeatInterval)
    }

    const totalHandlers = Array.from(this.namespaces.values()).reduce(
      (sum, e) => sum + e.handlers.length,
      0,
    )
    log.info(`WebSocket ready — ${this.namespaces.size} namespace(s), ${totalHandlers} handler(s)`)
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    // Close all connections
    for (const [, entry] of this.namespaces) {
      for (const [, socket] of entry.sockets) {
        socket.close(1001, 'Server shutting down')
      }
      entry.sockets.clear()
      entry.contexts.clear()
    }

    this.wss?.close()
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, entry: NamespaceEntry): void {
    const socketId = randomUUID()
    ;(ws as any).__alive = true

    entry.sockets.set(socketId, ws)
    this.totalConnections.value++
    this.activeConnections.value++

    const ctx = new WsContext(
      ws,
      this.wss!,
      this.roomManager,
      entry.sockets,
      socketId,
      entry.namespace,
    )
    entry.contexts.set(socketId, ctx)

    // Resolve controller from DI
    const controller = this.container!.resolve(entry.controllerClass)

    // Pong handler for heartbeat
    ws.on('pong', () => {
      ;(ws as any).__alive = true
    })

    // @OnConnect handlers
    this.invokeHandlers(controller, entry.handlers, 'connect', ctx)

    // Message handler
    ws.on('message', (raw: Buffer | string) => {
      this.messagesReceived.value++
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

        // Find matching @OnMessage handler
        const handler = entry.handlers.find((h) => h.type === 'message' && h.event === event)

        if (handler) {
          this.safeInvoke(controller, handler.handlerName, ctx)
        } else {
          // Try catch-all @OnMessage('*')
          const catchAll = entry.handlers.find((h) => h.type === 'message' && h.event === '*')
          if (catchAll) {
            this.safeInvoke(controller, catchAll.handlerName, ctx)
          }
        }
      } catch {
        ctx.data = { message: 'Invalid JSON' }
        this.invokeHandlers(controller, entry.handlers, 'error', ctx)
      }
    })

    // Close handler
    ws.on('close', () => {
      this.activeConnections.value--
      this.invokeHandlers(controller, entry.handlers, 'disconnect', ctx)
      this.roomManager.leaveAll(socketId)
      entry.sockets.delete(socketId)
      entry.contexts.delete(socketId)
    })

    // Error handler
    ws.on('error', (err: Error) => {
      this.wsErrors.value++
      ctx.data = { message: err.message, name: err.name }
      this.invokeHandlers(controller, entry.handlers, 'error', ctx)
    })
  }

  private invokeHandlers(
    controller: any,
    handlers: WsHandlerDefinition[],
    type: WsHandlerDefinition['type'],
    ctx: WsContext,
  ): void {
    for (const handler of handlers) {
      if (handler.type === type) {
        this.safeInvoke(controller, handler.handlerName, ctx)
      }
    }
  }

  private safeInvoke(controller: any, method: string, ctx: WsContext): void {
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
}
