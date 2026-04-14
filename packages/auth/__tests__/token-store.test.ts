import { describe, it, expect } from 'vitest'
import { MemoryTokenStore } from '../src/stores/memory.store'

describe('MemoryTokenStore', () => {
  it('isRevoked returns false for unknown token', async () => {
    const store = new MemoryTokenStore()
    expect(await store.isRevoked('unknown')).toBe(false)
  })

  it('isRevoked returns true after revoke', async () => {
    const store = new MemoryTokenStore()
    await store.revoke('token-1')
    expect(await store.isRevoked('token-1')).toBe(true)
  })

  it('isRevoked returns false for expired revocation entry', async () => {
    const store = new MemoryTokenStore()
    const past = new Date(Date.now() - 1000)
    await store.revoke('token-expired', past)
    expect(await store.isRevoked('token-expired')).toBe(false)
  })

  it('isRevoked returns true for non-expired revocation entry', async () => {
    const store = new MemoryTokenStore()
    const future = new Date(Date.now() + 60_000)
    await store.revoke('token-valid', future)
    expect(await store.isRevoked('token-valid')).toBe(true)
  })

  it('revokeAllForUser records bulk revocation timestamp', async () => {
    const store = new MemoryTokenStore()
    await store.revoke('t1', undefined, 'user-1')
    await store.revoke('t2', undefined, 'user-1')
    await store.revoke('t3', undefined, 'user-2')

    expect(store.getUserRevokedAt('user-1')).toBeNull()

    await store.revokeAllForUser('user-1')

    // Bulk revocation timestamp is recorded
    const revokedAt = store.getUserRevokedAt('user-1')
    expect(revokedAt).toBeInstanceOf(Date)

    // Individual entries for user-1 are cleaned up (redundant)
    expect(await store.isRevoked('t1')).toBe(false)
    expect(await store.isRevoked('t2')).toBe(false)

    // user-2 tokens unaffected
    expect(await store.isRevoked('t3')).toBe(true)
    expect(store.getUserRevokedAt('user-2')).toBeNull()
  })

  it('isUserRevoked checks if token was issued before bulk revocation', async () => {
    const store = new MemoryTokenStore()

    const issuedBefore = new Date(Date.now() - 60_000)
    await store.revokeAllForUser('user-1')

    // Token issued before revokeAll → revoked
    expect(store.isUserRevoked('user-1', issuedBefore)).toBe(true)

    // Token issued after revokeAll → not revoked
    const issuedAfter = new Date(Date.now() + 1000)
    expect(store.isUserRevoked('user-1', issuedAfter)).toBe(false)

    // User without bulk revocation → not revoked
    expect(store.isUserRevoked('user-2', issuedBefore)).toBe(false)
  })

  it('cleanup removes expired entries', async () => {
    const store = new MemoryTokenStore()
    const past = new Date(Date.now() - 1000)
    const future = new Date(Date.now() + 60_000)

    await store.revoke('expired-1', past)
    await store.revoke('valid-1', future)
    await store.revoke('no-expiry')

    await store.cleanup()

    expect(store.size).toBe(2) // valid-1 and no-expiry remain
    expect(await store.isRevoked('valid-1')).toBe(true)
    expect(await store.isRevoked('no-expiry')).toBe(true)
  })

  it('size reflects active entries', async () => {
    const store = new MemoryTokenStore()
    expect(store.size).toBe(0)

    await store.revoke('t1')
    await store.revoke('t2')
    expect(store.size).toBe(2)
  })
})
