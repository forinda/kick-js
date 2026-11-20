/** Named, reusable test containers — Testcontainers faked: no Docker needed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Info {
  Id: string
  Names: string[]
  Labels: Record<string, string>
  State: string
}
const fake = vi.hoisted(() => ({
  builders: [] as Array<{ image: string; calls: Array<[string, unknown[]]> }>,
  containers: [] as Info[],
  removed: [] as string[],
  stopped: [] as string[],
  startError: undefined as Error | undefined,
  starts: 0,
}))

vi.mock('testcontainers', () => {
  class GenericContainer {
    calls: Array<[string, unknown[]]> = []
    constructor(image: string) {
      fake.builders.push({ image, calls: this.calls })
    }
    private rec(name: string, args: unknown[]) {
      this.calls.push([name, args])
      return this
    }
    withExposedPorts(...a: unknown[]) {
      return this.rec('withExposedPorts', a)
    }
    withEnvironment(...a: unknown[]) {
      return this.rec('withEnvironment', a)
    }
    withEntrypoint(...a: unknown[]) {
      return this.rec('withEntrypoint', a)
    }
    withCommand(...a: unknown[]) {
      return this.rec('withCommand', a)
    }
    withWaitStrategy(...a: unknown[]) {
      return this.rec('withWaitStrategy', a)
    }
    withLabels(...a: unknown[]) {
      return this.rec('withLabels', a)
    }
    withName(...a: unknown[]) {
      return this.rec('withName', a)
    }
    withReuse(...a: unknown[]) {
      return this.rec('withReuse', a)
    }
    withTmpFs(...a: unknown[]) {
      return this.rec('withTmpFs', a)
    }
    private used = false
    async start() {
      fake.starts++
      // Like Testcontainers: start() changes the builder's labels (the reuse
      // hash), so starting the same builder again never finds the container.
      if (this.used)
        throw new Error('(HTTP code 409) Conflict. The container name "/x" is already in use')
      this.used = true
      if (fake.startError) {
        const e = fake.startError
        fake.startError = undefined
        throw e
      }
      return {
        getHost: () => 'h',
        getMappedPort: () => 1,
        stop: async () => void fake.stopped.push('stopped'),
      }
    }
  }
  return {
    GenericContainer,
    Wait: {
      forLogMessage: (...a: unknown[]) => ({ kind: 'log', a }),
      forListeningPorts: () => ({ kind: 'ports' }),
    },
    getContainerRuntimeClient: async () => ({
      container: {
        dockerode: {
          listContainers: async (opts: { filters?: { label?: string[] } }) => {
            const want = opts.filters?.label ?? []
            return fake.containers.filter((c) =>
              want.every((l) => {
                const [k, v] = l.split('=')
                return v === undefined ? (k as string) in c.Labels : c.Labels[k as string] === v
              }),
            )
          },
        },
        getById: (id: string) => ({ id }),
        remove: async (c: { id: string }) => void fake.removed.push(c.id),
      },
    }),
  }
})

const { reuseEnabled, startContainer, startService } = await import('../src/services')

const last = () => fake.builders.at(-1)!
const called = (name: string) =>
  last()
    .calls.filter(([n]) => n === name)
    .map(([, a]) => a)
const spec = { image: 'img:1', port: 5432, url: (h: string, p: number) => `x://${h}:${p}` }

beforeEach(() => {
  fake.builders.length = 0
  fake.containers.length = 0
  fake.removed.length = 0
  fake.stopped.length = 0
  fake.starts = 0
  vi.stubEnv('CI', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('reuseEnabled', () => {
  it('reuses a named container locally, not in CI unless asked', () => {
    expect(reuseEnabled('local', 'x', {})).toBe(true)
    expect(reuseEnabled(undefined, 'x', {})).toBe(true)
    expect(reuseEnabled('local', 'x', { CI: '1' })).toBe(false)
    expect(reuseEnabled(true, 'x', { CI: '1' })).toBe(true)
    expect(reuseEnabled(false, 'x', {})).toBe(false)
    expect(reuseEnabled(undefined, undefined, {})).toBe(false)
  })
})

describe('startContainer — names and reuse', () => {
  it('names, labels and reuses a named container', async () => {
    const s = await startContainer({ ...spec, name: 'x' })
    expect(called('withName')).toEqual([['x']])
    expect(called('withReuse')).toHaveLength(1)
    expect(called('withLabels')[0]![0]).toMatchObject({
      'kickjs.test': 'true',
      'kickjs.test.name': 'x',
    })
    expect(called('withWaitStrategy')[0]![0]).toEqual({ kind: 'ports' })
    expect(s.reused).toBe(true)
    await s.stop()
    expect(fake.stopped).toEqual([]) // a reused container stays up for the next run
  })

  it('labels an unnamed container, and stops it', async () => {
    const s = await startContainer(spec)
    expect(called('withName')).toEqual([])
    expect(called('withReuse')).toEqual([])
    expect(called('withLabels')[0]![0]).toMatchObject({ 'kickjs.test': 'true' })
    expect(s.reused).toBe(false)
    await s.stop()
    expect(fake.stopped).toEqual(['stopped'])
  })

  it("doesn't name or reuse in CI", async () => {
    vi.stubEnv('CI', 'true')
    const s = await startContainer({ ...spec, name: 'x' })
    expect(called('withName')).toEqual([])
    expect(called('withReuse')).toEqual([])
    expect(s.reused).toBe(false)
  })

  it('replaces a stopped container whose config changed', async () => {
    fake.containers.push({
      Id: 'old',
      Names: ['/x'],
      Labels: { 'kickjs.test': 'true', 'kickjs.test.name': 'x', 'kickjs.test.config': 'stale' },
      State: 'exited',
    })
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startContainer({ ...spec, name: 'x' })
    expect(fake.removed).toEqual(['old'])
    expect(log.mock.calls.flat().join(' ')).toContain('replacing x (config changed)')
  })

  it('never removes a running container with another config', async () => {
    fake.containers.push({
      Id: 'live',
      Names: ['/x'],
      Labels: { 'kickjs.test': 'true', 'kickjs.test.name': 'x', 'kickjs.test.config': 'stale' },
      State: 'running',
    })
    await expect(startContainer({ ...spec, name: 'x' })).rejects.toThrow(
      /x is running with another config/,
    )
    expect(fake.removed).toEqual([])
    expect(fake.starts).toBe(0)
  })

  it('attaches when another run created the name first', async () => {
    fake.startError = new Error(
      '(HTTP code 409) unexpected - Conflict. The container name "/x" is already in use',
    )
    const s = await startContainer({ ...spec, name: 'x' })
    expect(fake.starts).toBe(2)
    expect(fake.builders).toHaveLength(2) // a fresh builder: the first one's hash changed
    expect(s.reused).toBe(true)
  })

  it('keys the config on the Testcontainers version too', async () => {
    const { configOf } = await import('../src/services')
    expect(configOf(spec, '12.2.1')).not.toBe(configOf(spec, '13.0.0'))
    await startContainer({ ...spec, name: 'x' })
    const { createRequire } = await import('node:module')
    const version = createRequire(import.meta.url)('testcontainers/package.json').version
    expect(called('withLabels')[0]![0]).toMatchObject({
      'kickjs.test.config': configOf(spec, version),
    })
  })
})

describe('presets', () => {
  it('runs Postgres on tmpfs with fsync off', async () => {
    await startService('postgres')
    expect(called('withTmpFs')[0]![0]).toHaveProperty('/var/lib/postgresql/data')
    expect(JSON.stringify(called('withCommand'))).toContain('fsync=off')
  })

  it('has a MySQL preset', async () => {
    const s = await startService('mysql')
    expect(last().image).toBe('mysql:8.4')
    expect(s.url).toBe('mysql://root:test@h:1/test')
    expect(called('withTmpFs')[0]![0]).toHaveProperty('/var/lib/mysql')
  })
})

describe('preset overrides', () => {
  it('merges env over the preset, and builds the URL from it', async () => {
    const s = await startService('postgres', {
      env: { POSTGRES_DB: 'app_test', POSTGRES_PASSWORD: 'pw' },
    })
    expect(called('withEnvironment')[0]![0]).toMatchObject({
      POSTGRES_USER: 'test',
      POSTGRES_DB: 'app_test',
      POSTGRES_PASSWORD: 'pw',
    })
    expect(s.url).toBe('postgres://test:pw@h:1/app_test')
    const m = await startService('mysql', {
      env: { MYSQL_DATABASE: 'shop_test', MYSQL_ROOT_PASSWORD: 'r' },
    })
    expect(m.url).toBe('mysql://root:r@h:1/shop_test')
  })

  it('replaces the command, and turns tmpfs off', async () => {
    await startService('postgres', {
      command: ['postgres', '-c', 'max_connections=300'],
      tmpfs: false,
    })
    expect(called('withCommand')).toEqual([[['postgres', '-c', 'max_connections=300']]])
    expect(called('withTmpFs')).toEqual([])
  })

  it('maps a fixed host port, for presets and any container', async () => {
    const s = await startService('redis', { hostPort: 56379 })
    expect(called('withExposedPorts')).toEqual([[{ container: 6379, host: 56379 }]])
    expect(s.port).toBe(1) // what the started container reports
    await startContainer({ ...spec, hostPort: 55000 })
    expect(called('withExposedPorts')).toEqual([[{ container: 5432, host: 55000 }]])
  })

  it('counts an override as another config, so reuse never attaches across them', async () => {
    fake.containers.push({
      Id: 'old',
      Names: ['/x'],
      Labels: { 'kickjs.test': 'true', 'kickjs.test.name': 'x', 'kickjs.test.config': 'stale' },
      State: 'exited',
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startService('postgres', { name: 'x', hostPort: 55432 })
    expect(fake.removed).toEqual(['old'])
  })
})
