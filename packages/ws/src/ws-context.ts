import type { WebSocket, WebSocketServer } from 'ws'
import type { RoomManager } from './room-manager'

/**
 * Context object passed to WebSocket handler methods.
 * Analogous to RequestContext for HTTP controllers.
 *
 * @example
 * ```ts
 * @OnMessage('chat:send')
 * handleSend(ctx: WsContext) {
 *   console.log(ctx.data)          // parsed message payload
 *   ctx.send('chat:ack', { ok: true })
 *   ctx.broadcast('chat:receive', ctx.data)
 *   ctx.join('room-1')
 *   ctx.to('room-1').send('chat:receive', ctx.data)
 * }
 * ```
 */
export class WsContext {
  /** Unique connection ID */
  readonly id: string
  /** Parsed message payload (set for @OnMessage handlers) */
  data: any
  /** Event name from the message envelope (set for @OnMessage handlers) */
  event: string
  /** The namespace this connection belongs to */
  readonly namespace: string

  private metadata = new Map<string, any>()

  constructor(
    readonly socket: WebSocket,
    readonly server: WebSocketServer,
    private readonly roomManager: RoomManager,
    private readonly namespaceSockets: Map<string, WebSocket>,
    id: string,
    namespace: string,
  ) {
    this.id = id
    this.namespace = namespace
    this.data = null
    this.event = ''
  }

  /** Get a metadata value */
  get<T = any>(key: string): T | undefined {
    return this.metadata.get(key)
  }

  /** Set a metadata value (persists for the lifetime of the connection) */
  set(key: string, value: any): void {
    this.metadata.set(key, value)
  }

  /** Send a message to this socket */
  send(event: string, data: any): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify({ event, data }))
    }
  }

  /** Send to all sockets in the same namespace except this one */
  broadcast(event: string, data: any): void {
    const message = JSON.stringify({ event, data })
    for (const [id, socket] of this.namespaceSockets) {
      if (id !== this.id && socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    }
  }

  /** Send to all sockets in the same namespace including this one */
  broadcastAll(event: string, data: any): void {
    const message = JSON.stringify({ event, data })
    for (const [, socket] of this.namespaceSockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    }
  }

  /** Join a room */
  join(room: string): void {
    this.roomManager.join(this.id, this.socket, room)
  }

  /** Leave a room */
  leave(room: string): void {
    this.roomManager.leave(this.id, room)
  }

  /** Get all rooms this socket is in */
  rooms(): string[] {
    return this.roomManager.getRooms(this.id)
  }

  /** Send to all sockets in a room */
  to(room: string): { send(event: string, data: any): void } {
    return {
      send: (event: string, data: any) => {
        this.roomManager.broadcast(room, event, data)
      },
    }
  }
}
