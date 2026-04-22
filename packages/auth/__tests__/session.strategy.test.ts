import { describe, it, expect, vi } from 'vitest'
import { SessionStrategy } from '../src/strategies/session.strategy'

describe('SessionStrategy', () => {
  it('returns null when no session exists', async () => {
    const strategy = SessionStrategy()
    expect(await strategy.validate({ session: undefined })).toBeNull()
  })

  it('returns null when session has no data', async () => {
    const strategy = SessionStrategy()
    expect(await strategy.validate({ session: {} })).toBeNull()
  })

  it('returns null when session data lacks userKey', async () => {
    const strategy = SessionStrategy()
    expect(await strategy.validate({ session: { data: { name: 'Alice' } } })).toBeNull()
  })

  it('returns session.data as AuthUser when userId is present', async () => {
    const strategy = SessionStrategy()
    const data = { userId: '1', email: 'alice@test.com', roles: ['user'] }
    const result = await strategy.validate({ session: { data } })
    expect(result).toEqual(data)
  })

  it('uses custom userKey', async () => {
    const strategy = SessionStrategy({ userKey: 'uid' })
    const data = { uid: '1', name: 'Alice' }
    const result = await strategy.validate({ session: { data } })
    expect(result).toEqual(data)
  })

  it('calls resolveUser when provided', async () => {
    const resolveUser = vi.fn().mockResolvedValue({ id: '1', name: 'Resolved' })
    const strategy = SessionStrategy({ resolveUser })
    const data = { userId: '1', email: 'alice@test.com' }

    const result = await strategy.validate({ session: { data } })
    expect(resolveUser).toHaveBeenCalledWith(data)
    expect(result).toEqual({ id: '1', name: 'Resolved' })
  })

  it('returns null when resolveUser returns null', async () => {
    const resolveUser = vi.fn().mockResolvedValue(null)
    const strategy = SessionStrategy({ resolveUser })

    const result = await strategy.validate({ session: { data: { userId: '1' } } })
    expect(result).toBeNull()
  })

  it('has name "session"', () => {
    expect(SessionStrategy().name).toBe('session')
  })
})
