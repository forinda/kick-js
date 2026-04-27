import { describe, it, expect, vi } from 'vitest'
import { KickDbEventEmitter } from '../../src/client/events'

describe('KickDbEventEmitter', () => {
  it('on/off subscribe + unsubscribe symmetric', () => {
    const e = new KickDbEventEmitter()
    const fn = vi.fn()
    e.on('query', fn)
    e.emit('query', { sql: 'SELECT 1', parameters: [], durationMs: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    e.off('query', fn)
    e.emit('query', { sql: 'SELECT 1', parameters: [], durationMs: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('multiple listeners on same event each fire once', () => {
    const e = new KickDbEventEmitter()
    const a = vi.fn()
    const b = vi.fn()
    e.on('queryError', a)
    e.on('queryError', b)
    e.emit('queryError', { sql: 'X', parameters: [], error: new Error('boom') })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('events on different topics are isolated', () => {
    const e = new KickDbEventEmitter()
    const onQuery = vi.fn()
    const onCommit = vi.fn()
    e.on('query', onQuery)
    e.on('transactionCommit', onCommit)
    e.emit('query', { sql: 'X', parameters: [], durationMs: 0 })
    expect(onQuery).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
