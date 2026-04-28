import { describe, it, expect } from 'vitest'
import { MemoryMigrationAdapter } from '@forinda/kickjs-db'

describe('MemoryMigrationAdapter lock', () => {
  it('acquireLock returns true on first call, false while held', async () => {
    const a = new MemoryMigrationAdapter()
    expect(await a.acquireLock('p1')).toBe(true)
    expect(await a.acquireLock('p2')).toBe(false)
  })

  it('releaseLock allows the next acquire', async () => {
    const a = new MemoryMigrationAdapter()
    await a.acquireLock('p1')
    await a.releaseLock()
    expect(await a.acquireLock('p2')).toBe(true)
  })

  it('listApplied / recordApplied / removeApplied round-trip', async () => {
    const a = new MemoryMigrationAdapter()
    expect(await a.listApplied()).toEqual([])
    await a.recordApplied({ id: 'a', name: 'a', hash: 'h', batch: 1, direction: 'up' })
    expect((await a.listApplied()).map((r) => r.id)).toEqual(['a'])
    await a.removeApplied('a')
    expect(await a.listApplied()).toEqual([])
  })
})
