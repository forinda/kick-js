import { describe, it, expect } from 'vitest'
import { DB_PRIMARY, DB_REPLICA, DB_CLIENT } from '@forinda/kickjs-db'

describe('DI tokens', () => {
  it('DB_PRIMARY uses the kick/ first-party namespace', () => {
    expect(DB_PRIMARY.name).toBe('kick/db/primary')
  })

  it('DB_REPLICA uses the kick/ first-party namespace', () => {
    expect(DB_REPLICA.name).toBe('kick/db/replica')
  })

  it('DB_CLIENT is the same reference as DB_PRIMARY', () => {
    expect(DB_CLIENT).toBe(DB_PRIMARY)
  })

  it('DB_PRIMARY and DB_REPLICA are distinct token references', () => {
    expect(DB_PRIMARY).not.toBe(DB_REPLICA)
    expect(DB_PRIMARY.name).not.toBe(DB_REPLICA.name)
  })
})
