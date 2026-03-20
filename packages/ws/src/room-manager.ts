import type { WebSocket } from 'ws'

/**
 * Manages WebSocket room membership and broadcasting.
 * Standalone from ws/socket.io — can be swapped for socket.io's built-in rooms.
 */
export class RoomManager {
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

  /** Broadcast to all sockets in a room, optionally excluding one */
  broadcast(room: string, event: string, data: any, excludeId?: string): void {
    const sockets = this.roomSockets.get(room)
    if (!sockets) return

    const message = JSON.stringify({ event, data })
    for (const [id, socket] of sockets) {
      if (id !== excludeId && socket.readyState === socket.OPEN) {
        socket.send(message)
      }
    }
  }
}
