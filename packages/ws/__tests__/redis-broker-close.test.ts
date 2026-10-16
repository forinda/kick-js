import { describe, expect, it } from 'vitest'
import { redisBroker } from '../src/redis'

const client = (unsubscribe: () => Promise<unknown>, status?: string) => ({
  publish: async () => 0,
  subscribe: async () => 1,
  unsubscribe,
  on: () => undefined,
  off: () => undefined,
  status,
})

describe('redisBroker close()', () => {
  it('ignores a subscriber the app already quit', async () => {
    const sub = client(() => Promise.reject(new Error('Connection is closed.')))
    const broker = redisBroker({ publisher: client(async () => 0), subscriber: sub })
    await broker.subscribe(() => {})
    await expect(broker.close()).resolves.toBeUndefined()
  })

  it("ignores any failure once the client's status is 'end'", async () => {
    const sub = client(() => Promise.reject(new Error('whatever')), 'end')
    const broker = redisBroker({ publisher: client(async () => 0), subscriber: sub })
    await broker.subscribe(() => {})
    await expect(broker.close()).resolves.toBeUndefined()
  })

  it('propagates a failure from a live subscriber, which still holds the subscription', async () => {
    const sub = client(() => Promise.reject(new Error('NOPERM')), 'ready')
    const broker = redisBroker({ publisher: client(async () => 0), subscriber: sub })
    await broker.subscribe(() => {})
    await expect(broker.close()).rejects.toThrow('NOPERM')
  })
})
