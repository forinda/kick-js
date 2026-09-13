import type { WebSocket } from 'ws'

/**
 * Manages WebSocket room membership and broadcasting.
 * Standalone from ws/socket.io — can be swapped for socket.io's built-in rooms.
 *
 * Room names are GLOBAL, not per namespace: a room joined from `/ws/chat` and
 * one joined from `/ws/admin` with the same name are the same room. That is
 * what lets a service broadcast through `WS_ROOM_MANAGER` and lets `user:<id>`
 * reach a user's sockets in every namespace — prefix names (`chat:lobby`) when
 * namespaces must not overlap.
 *
 * Membership lives in this process only: `getSockets` and `getAllRooms`
 * describe this instance. `broadcast` reaches other instances when the adapter
 * has a broker.
 */
export class RoomManager {
  /**
   * @param onSend Called with the number of frames each broadcast wrote.
   * @param onBroadcast Relays each broadcast to other instances.
   */
  constructor(
    private readonly onSend?: (count: number) => void,
    private readonly onBroadcast?: (
      room: string,
      event: string,
      data: any,
      excludeId?: string,
    ) => void,
  ) {}

  /** socketId → set of room names */
  private socketRooms = new Map<string, Set<string>>()
  /** room name → set of { socketId, socket } */
  private roomSockets = new Map<string, Map<string, WebSocket>>()

  join(socketId: string, socket: WebSocket, room: string): void {
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set())
    }
    this.socketRooms.get(socketId)!.add(room)

    if (!this.roomSockets.has(room)) {
      this.roomSockets.set(room, new Map())
    }
    this.roomSockets.get(room)!.set(socketId, socket)
  }

  leave(socketId: string, room: string): void {
    this.socketRooms.get(socketId)?.delete(room)
    this.roomSockets.get(room)?.delete(socketId)

    // Clean up empty rooms
    if (this.roomSockets.get(room)?.size === 0) {
      this.roomSockets.delete(room)
    }
  }

  /** Remove socket from all rooms (called on disconnect) */
  leaveAll(socketId: string): void {
    const rooms = this.socketRooms.get(socketId)
    if (rooms) {
      for (const room of rooms) {
        this.roomSockets.get(room)?.delete(socketId)
        if (this.roomSockets.get(room)?.size === 0) {
          this.roomSockets.delete(room)
        }
      }
    }
    this.socketRooms.delete(socketId)
  }

  getRooms(socketId: string): string[] {
    return Array.from(this.socketRooms.get(socketId) ?? [])
  }

  getSockets(room: string): Map<string, WebSocket> {
    return this.roomSockets.get(room) ?? new Map()
  }

  /** Get all rooms with their member counts */
  getAllRooms(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [room, sockets] of this.roomSockets) {
      result[room] = sockets.size
    }
    return result
  }

  /** Broadcast to all sockets in a room, optionally excluding one — on every instance when a broker is set. */
  broadcast(room: string, event: string, data: any, excludeId?: string): void {
    this.deliver(room, event, data, excludeId)
    this.onBroadcast?.(room, event, data, excludeId)
  }

  /** Send to this instance's members of a room only. Relayed broadcasts land here. */
  deliver(room: string, event: string, data: any, excludeId?: string): void {
    const sockets = this.roomSockets.get(room)
    if (!sockets) return

    const message = JSON.stringify({ event, data })
    let sent = 0
    for (const [id, socket] of sockets) {
      if (id !== excludeId && socket.readyState === socket.OPEN) {
        socket.send(message)
        sent++
      }
    }
    if (sent) this.onSend?.(sent)
  }
}
