/**
 * Socket.IO transport for the same `@WsController` classes {@link WsAdapter}
 * serves. Pick it for what Socket.IO brings — client reconnection, long-polling
 * fallback, acknowledgements — and scale it with Socket.IO's own adapters
 * (`@socket.io/redis-adapter`) rather than a {@link WsBroker}.
 *
 * ```ts
 * import { SocketIoAdapter } from '@forinda/kickjs-ws/socket.io'
 *
 * bootstrap({ modules, adapters: [SocketIoAdapter({ cors: { origin: 'https://app.example.com' } })] })
 * ```
 *
 * @module @forinda/kickjs-ws/socket.io
 */
import type { IncomingMessage } from 'node:http'
import { Server, type Namespace, type ServerOptions, type Socket } from 'socket.io'
import {
  createLogger,
  createToken,
  defineAdapter,
  getClassMeta,
  getClassMetaOrUndefined,
} from '@forinda/kickjs'
import {
  WS_METADATA,
  WS_USER_BROADCASTER,
  wsControllerRegistry,
  type WsAuthConfig,
  type WsHandlerDefinition,
  type WsUserBroadcaster,
} from './interfaces'
import { parseCookies } from './ws-context'

const log = createLogger('SocketIoAdapter')

/** Events held from a socket whose async `@OnConnect` has not settled. */
const MAX_PENDING_BEFORE_CONNECT = 64
/** Total payload held meanwhile, measured as JSON. */
const MAX_PENDING_BYTES_BEFORE_CONNECT = 1024 * 1024

/** DI token for the Socket.IO `Server`. */
export const SOCKET_IO = createToken<Server>('kick/ws/SocketIo')

/** Socket.IO server options (`cors`, `path`, `adapter`, …) plus the shared auth hook. */
export interface SocketIoAdapterOptions extends Partial<ServerOptions> {
  /**
   * Same contract as {@link WsAdapterOptions.auth}, run as namespace
   * middleware before the connection is accepted. A rejection reaches the
   * client as a `connect_error` whose message is `Unauthorized`.
   */
  auth?: WsAuthConfig
}

/**
 * What `@WsController` handlers receive under {@link SocketIoAdapter}. Mirrors
 * `WsContext`, so a controller written against one runs on the other — with
 * one difference: Socket.IO rooms belong to a namespace, where `ws` rooms are
 * shared across namespaces.
 */
export class SocketIoContext {
  /** Payload of the current event (set for `@OnMessage` handlers). */
  data: any = null
  /** Name of the current event (set for `@OnMessage` handlers). */
  event = ''

  private metadata = new Map<string, any>()

  constructor(
    readonly socket: Socket,
    readonly server: Server,
    /** The `@WsController` namespace, e.g. `/chat`. */
    readonly namespace: string,
  ) {}

  get id(): string {
    return this.socket.id
  }

  /** The handshake request — cookies, headers, query, client IP. */
  get request(): IncomingMessage {
    return this.socket.request
  }

  get cookies(): Record<string, string> {
    return parseCookies(this.request.headers.cookie)
  }

  get<T = any>(key: string): T | undefined {
    return this.metadata.get(key)
  }

  set(key: string, value: any): void {
    this.metadata.set(key, value)
  }

  /** Emit to this socket. */
  send(event: string, data: any): void {
    this.socket.emit(event, data)
  }

  /** Emit to every socket in the namespace except this one. */
  broadcast(event: string, data: any): void {
    this.socket.broadcast.emit(event, data)
  }

  /** Emit to every socket in the namespace, this one included. */
  broadcastAll(event: string, data: any): void {
    this.socket.nsp.emit(event, data)
  }

  /** Join a room in this namespace. Returns the adapter's promise when its join is async. */
  join(room: string): void | Promise<void> {
    return this.socket.join(room)
  }

  leave(room: string): void | Promise<void> {
    return this.socket.leave(room)
  }

  /** Rooms this socket joined, without Socket.IO's own per-socket room. */
  rooms(): string[] {
    return [...this.socket.rooms].filter((room) => room !== this.socket.id)
  }

  /** Emit to every socket in a room of this namespace, this one included. */
  to(room: string): { send(event: string, data: any): void } {
    return {
      send: (event: string, data: any) => {
        this.socket.nsp.to(room).emit(event, data)
      },
    }
  }
}

/**
 * Serves `@WsController` classes over Socket.IO. Namespaces map one-to-one
 * (`@WsController('/chat')` → `io.of('/chat')`), `@OnMessage('send')` handles
 * the client's `socket.emit('send', data)`, and `@OnMessage('*')` catches events
 * no other handler claims.
 *
 * Registers {@link SOCKET_IO} and `WS_USER_BROADCASTER`. Not `WS_ROOM_MANAGER`:
 * Socket.IO keeps its own rooms — reach them through `SOCKET_IO`.
 */
export const SocketIoAdapter = defineAdapter<SocketIoAdapterOptions>({
  name: 'SocketIoAdapter',
  build: ({ auth, ...serverOptions }) => {
    const io = new Server(serverOptions)
    const namespaces: Namespace[] = []
    const userRoomPrefix = auth?.userRoomPrefix ?? 'user:'
    const userRoom = (userId: string): string => userRoomPrefix + userId

    const invoke = async (controller: any, method: string, ctx: SocketIoContext): Promise<void> => {
      try {
        await controller[method](ctx)
      } catch (err) {
        log.error({ err }, `Socket.IO handler error in ${method}`)
      }
    }
    const invokeAll = (
      controller: any,
      handlers: WsHandlerDefinition[],
      type: WsHandlerDefinition['type'],
      ctx: SocketIoContext,
    ): Promise<unknown> =>
      Promise.all(
        handlers.filter((h) => h.type === type).map((h) => invoke(controller, h.handlerName, ctx)),
      )

    // Socket.IO rooms are per namespace, so a user's sockets sit in `user:<id>`
    // once per namespace they connected to. Emitting through each namespace
    // also crosses instances when a Socket.IO adapter is configured.
    const userBroadcaster: WsUserBroadcaster = {
      roomFor: userRoom,
      broadcastToUser: (userId, event, data) => {
        for (const nsp of namespaces) nsp.to(userRoom(userId)).emit(event, data)
      },
      toUser: (userId) => ({
        send: (event, data) => userBroadcaster.broadcastToUser(userId, event, data),
      }),
    }

    const handleConnection = (
      socket: Socket,
      namespace: string,
      handlers: WsHandlerDefinition[],
      controller: any,
    ): void => {
      const ctx = new SocketIoContext(socket, io, namespace)
      const user = socket.data.user
      let userRoomJoined: void | Promise<void> = undefined
      if (user) {
        ctx.set('user', user)
        ctx.set('userId', user.id)
        if (auth?.autoJoinUserRoom !== false) userRoomJoined = ctx.join(userRoom(user.id))
      }

      // One context per event, inheriting the socket's (methods, get/set
      // store): a handler suspended on an await must not read the next event's
      // data off a shared object.
      const forEvent = (event: string, data: unknown): SocketIoContext => {
        const eventCtx: SocketIoContext = Object.create(ctx)
        eventCtx.event = event
        eventCtx.data = data
        return eventCtx
      }

      const dispatch = (event: string, data: unknown): void => {
        const handler =
          handlers.find((h) => h.type === 'message' && h.event === event) ??
          handlers.find((h) => h.type === 'message' && h.event === '*')
        if (!handler) return
        void invoke(controller, handler.handlerName, forEvent(event, data))
      }

      // Listeners go on now — Socket.IO drops events nobody listens for — but
      // events are held until every @OnConnect settles, so handlers never see a
      // socket whose connect setup is unfinished. Same limits as WsAdapter;
      // payloads arrive parsed, so their size is measured as JSON.
      let ready = false
      const pending: Array<[string, unknown]> = []
      let pendingBytes = 0
      socket.onAny((event: string, data: unknown) => {
        if (ready) return dispatch(event, data)
        // The event name is client-controlled and held too, so it counts.
        const size = Buffer.byteLength(JSON.stringify([event, data]))
        if (
          pending.length >= MAX_PENDING_BEFORE_CONNECT ||
          pendingBytes + size > MAX_PENDING_BYTES_BEFORE_CONNECT
        ) {
          pending.length = 0
          pendingBytes = 0
          socket.disconnect(true)
          return
        }
        pending.push([event, data])
        pendingBytes += size
      })

      socket.on('disconnect', () => {
        pending.length = 0
        pendingBytes = 0
        void invokeAll(controller, handlers, 'disconnect', ctx)
      })
      socket.on('error', (err: Error) => {
        const errorCtx = forEvent(ctx.event, { message: err.message, name: err.name })
        void invokeAll(controller, handlers, 'error', errorCtx)
      })

      // The user-room join can be async with some Socket.IO adapters; @OnConnect
      // must not emit to `user:<id>` before this socket is in it.
      void Promise.resolve(userRoomJoined)
        .then(() => invokeAll(controller, handlers, 'connect', ctx))
        .then(() => {
          if (!socket.connected) return
          ready = true
          pendingBytes = 0
          for (const [event, data] of pending.splice(0)) dispatch(event, data)
        })
        // A rejected join would otherwise leave the socket connected with its
        // events held forever. Handlers never reject (errors are logged).
        .catch((err) => {
          log.error({ err }, 'Socket.IO user-room join failed; disconnecting')
          pending.length = 0
          pendingBytes = 0
          socket.disconnect(true)
        })
    }

    return {
      beforeStart({ container }) {
        container.registerInstance(SOCKET_IO, io)
        container.registerInstance(WS_USER_BROADCASTER, userBroadcaster)

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

          const nsp = io.of(namespace)
          namespaces.push(nsp)

          if (auth) {
            nsp.use(async (socket, next) => {
              try {
                const resolved = await auth.resolveUser(socket.request, socket.handshake.auth)
                if (!resolved?.id) return next(new Error('Unauthorized'))
                socket.data.user = resolved
                next()
              } catch {
                next(new Error('Unauthorized'))
              }
            })
          }

          nsp.on('connection', (socket) =>
            handleConnection(socket, namespace, handlers, container.resolve(controllerClass)),
          )
          log.info(`Registered Socket.IO namespace: ${namespace} (${controllerClass.name})`)
        }
      },

      afterStart({ server }) {
        if (server) io.attach(server)
      },

      async shutdown() {
        // Not io.close(): it also closes the HTTP server, which KickJS owns.
        await Promise.allSettled(
          namespaces.map(async (nsp) => {
            nsp.disconnectSockets(true)
            await nsp.adapter.close()
          }),
        )
        io.engine?.close()
      },
    }
  },
})
