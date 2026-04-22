import { describe, it, expect } from 'vitest'
import { RoomManager } from '@forinda/kickjs-ws'

// Note: WebSocket integration tests require a real server and don't work
// in vitest's worker_threads environment. Use one of the task-* example
// apps for end-to-end WebSocket testing.

describe('RoomManager', () => {
  it('should join and leave rooms', () => {
    const rm = new RoomManager()
    const mockSocket = { readyState: 1, OPEN: 1, send: () => {} } as any

    rm.join('s1', mockSocket, 'room-a')
    rm.join('s1', mockSocket, 'room-b')

    expect(rm.getRooms('s1')).toEqual(['room-a', 'room-b'])

    rm.leave('s1', 'room-a')
    expect(rm.getRooms('s1')).toEqual(['room-b'])
  })

  it('should leaveAll on disconnect', () => {
    const rm = new RoomManager()
    const mockSocket = { readyState: 1, OPEN: 1, send: () => {} } as any

    rm.join('s1', mockSocket, 'room-a')
    rm.join('s1', mockSocket, 'room-b')
    rm.leaveAll('s1')

    expect(rm.getRooms('s1')).toEqual([])
    expect(rm.getSockets('room-a').size).toBe(0)
    expect(rm.getSockets('room-b').size).toBe(0)
  })

  it('should broadcast to room excluding sender', () => {
    const rm = new RoomManager()
    const sent: string[] = []
    const mockSocket1 = {
      readyState: 1,
      OPEN: 1,
      send: (msg: string) => sent.push(`s1:${msg}`),
    } as any
    const mockSocket2 = {
      readyState: 1,
      OPEN: 1,
      send: (msg: string) => sent.push(`s2:${msg}`),
    } as any

    rm.join('s1', mockSocket1, 'room-a')
    rm.join('s2', mockSocket2, 'room-a')

    rm.broadcast('room-a', 'hello', { text: 'hi' }, 's1')

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('s2:')
    expect(JSON.parse(sent[0].replace('s2:', ''))).toEqual({
      event: 'hello',
      data: { text: 'hi' },
    })
  })

  it('should broadcast to all in room without exclusion', () => {
    const rm = new RoomManager()
    const sent: string[] = []
    const mockSocket1 = {
      readyState: 1,
      OPEN: 1,
      send: (msg: string) => sent.push(msg),
    } as any
    const mockSocket2 = {
      readyState: 1,
      OPEN: 1,
      send: (msg: string) => sent.push(msg),
    } as any

    rm.join('s1', mockSocket1, 'room-a')
    rm.join('s2', mockSocket2, 'room-a')

    rm.broadcast('room-a', 'ping', {})

    expect(sent).toHaveLength(2)
  })

  it('should handle empty rooms gracefully', () => {
    const rm = new RoomManager()

    expect(rm.getRooms('nonexistent')).toEqual([])
    expect(rm.getSockets('nonexistent').size).toBe(0)

    // Should not throw
    rm.broadcast('nonexistent', 'test', {})
    rm.leave('nonexistent', 'room')
    rm.leaveAll('nonexistent')
  })

  it('should clean up empty rooms after last socket leaves', () => {
    const rm = new RoomManager()
    const mockSocket = { readyState: 1, OPEN: 1, send: () => {} } as any

    rm.join('s1', mockSocket, 'room-a')
    expect(rm.getSockets('room-a').size).toBe(1)

    rm.leave('s1', 'room-a')
    expect(rm.getSockets('room-a').size).toBe(0)
  })

  it('should not send to closed sockets', () => {
    const rm = new RoomManager()
    const sent: string[] = []
    const openSocket = {
      readyState: 1,
      OPEN: 1,
      send: (msg: string) => sent.push(msg),
    } as any
    const closedSocket = {
      readyState: 3, // CLOSED
      OPEN: 1,
      send: (msg: string) => sent.push(msg),
    } as any

    rm.join('s1', openSocket, 'room-a')
    rm.join('s2', closedSocket, 'room-a')

    rm.broadcast('room-a', 'test', { data: 1 })

    expect(sent).toHaveLength(1) // Only open socket receives
  })
})
