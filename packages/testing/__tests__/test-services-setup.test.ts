/** kickTestServices: one container per service for the whole run, its URL handed to every file. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const started = vi.hoisted(() => ({
  order: [] as string[],
  stopped: [] as string[],
  fail: undefined as string | undefined,
}))

vi.mock('../src/services', async (orig) => {
  const real = await orig<typeof import('../src/services')>()
  const make = (key: string, reused: boolean) => ({
    url: `${key}://h:1`,
    host: 'h',
    port: 1,
    reused,
    stop: async () => void (reused || started.stopped.push(key)),
  })
  return {
    ...real,
    startService: vi.fn(async (kind: string, o: { name?: string }) => {
      started.order.push(`start:${kind}`)
      await new Promise((r) => setTimeout(r, 5))
      if (started.fail === kind) throw new Error(`${kind} failed`)
      started.order.push(`up:${kind}`)
      return make(kind, !!o?.name)
    }),
    startContainer: vi.fn(async (spec: { image: string }) => make(spec.image, false)),
  }
})

const { kickTestServices } = await import('../src/vitest')

afterEach(() => {
  started.order.length = 0
  started.stopped.length = 0
  started.fail = undefined
  for (const k of Object.keys(process.env)) if (k.startsWith('KICK_TEST_')) delete process.env[k]
})

const project = () => {
  const provided: Record<string, unknown> = {}
  return { provided, provide: (k: string, v: unknown) => void (provided[k] = v) }
}

describe('kickTestServices', () => {
  it('starts every service at once, and hands each URL to the tests', async () => {
    const p = project()
    await kickTestServices({ postgres: { name: 'pg' }, redis: {} })(p)
    expect(started.order.slice(0, 2)).toEqual(['start:postgres', 'start:redis'])
    expect(p.provided).toEqual({ postgres: 'postgres://h:1', redis: 'redis://h:1' })
    expect(process.env.KICK_TEST_POSTGRES_URL).toBe('postgres://h:1')
    expect(process.env.KICK_TEST_REDIS_URL).toBe('redis://h:1')
  })

  it('starts any container by key', async () => {
    const p = project()
    await kickTestServices({
      'search-engine': { container: { image: 'search', port: 9200, url: () => 'x' } },
    })(p)
    expect(p.provided['search-engine']).toBe('search://h:1')
    expect(process.env.KICK_TEST_SEARCH_ENGINE_URL).toBe('search://h:1')
  })

  it('stops only the services that are not reused, at teardown', async () => {
    const teardown = await kickTestServices({ postgres: { name: 'pg' }, redis: {} })(project())
    await teardown()
    expect(started.stopped).toEqual(['redis'])
  })

  it('stops what did start when another service fails, and names the failure', async () => {
    started.fail = 'redis'
    await expect(kickTestServices({ postgres: {}, redis: {} })(project())).rejects.toThrow(
      /redis failed/,
    )
    expect(started.stopped).toEqual(['postgres'])
  })

  it('refuses a key that is no preset and has no container', async () => {
    await expect(kickTestServices({ nosuch: {} } as never)(project())).rejects.toThrow(/nosuch/)
  })
})
