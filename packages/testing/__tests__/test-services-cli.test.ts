/** kick test:services ls|down — only ever containers labelled kickjs.test. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'

const fake = vi.hoisted(() => ({
  containers: [] as Array<{
    Id: string
    Names: string[]
    Image: string
    State: string
    Created: number
    Labels: Record<string, string>
    Ports: Array<{ PublicPort?: number }>
  }>,
  removed: [] as string[],
  down: false,
}))

vi.mock('testcontainers', () => ({
  getContainerRuntimeClient: async () => {
    if (fake.down) throw new Error('connect ENOENT /var/run/docker.sock')
    return {
      container: {
        dockerode: {
          listContainers: async (opts: { all?: boolean; filters?: { label?: string[] } }) =>
            fake.containers.filter((c) =>
              (opts.filters?.label ?? []).every((l) => {
                const [k, v] = l.split('=') as [string, string | undefined]
                return v === undefined ? k in c.Labels : c.Labels[k] === v
              }),
            ),
        },
        getById: (id: string) => ({ id }),
        stop: async () => {},
        remove: async (c: { id: string }, o: { removeVolumes?: boolean }) => {
          expect(o).toMatchObject({ removeVolumes: true })
          fake.removed.push(c.id)
        },
      },
    }
  },
}))

const { listTestContainers, removeTestContainers, testServicesCliPlugin } =
  await import('../src/cli')

const add = (Id: string, name: string, labels: Record<string, string>, State = 'running') =>
  fake.containers.push({
    Id,
    Names: [`/${name}`],
    Image: 'postgres:17-alpine',
    State,
    Created: 0,
    Labels: labels,
    Ports: [{ PublicPort: 5555 }],
  })

afterEach(() => {
  fake.containers.length = 0
  fake.removed.length = 0
  fake.down = false
  vi.restoreAllMocks()
  process.exitCode = 0
})

describe('test containers', () => {
  it('lists only kickjs.test containers, stopped ones too', async () => {
    add('a', 'app-pg', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-pg' })
    add('b', 'app-redis', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-redis' }, 'exited')
    add('c', 'vite-minio', {})
    const list = await listTestContainers()
    expect(list.map((c) => c.name)).toEqual(['app-pg', 'app-redis'])
    expect(list[0]).toMatchObject({ image: 'postgres:17-alpine', state: 'running', port: 5555 })
  })

  it('removes all of them, or only the names given, never others', async () => {
    add('a', 'app-pg', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-pg' })
    add('b', 'app-redis', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-redis' })
    add('c', 'vite-minio', {})
    expect(await removeTestContainers(['app-redis'])).toEqual(['app-redis'])
    expect(fake.removed).toEqual(['b'])
    fake.removed.length = 0
    expect(await removeTestContainers()).toEqual(['app-pg', 'app-redis'])
    expect(fake.removed).toEqual(['a', 'b'])
  })
})

describe('kick test:services', () => {
  const run = async (...args: string[]) => {
    const lines: string[] = []
    const program = new Command().exitOverride()
    await testServicesCliPlugin.register!(program, {
      cwd: '/p',
      projectRoot: '/p',
      config: null,
      log: (m: string) => void lines.push(m),
    })
    await program.parseAsync(['node', 'kick', 'test:services', ...args])
    return lines
  }

  it('ls prints one line per container', async () => {
    add('a', 'app-pg', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-pg' })
    const lines = await run('ls')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/app-pg.*postgres:17-alpine.*running.*5555/)
  })

  it('down removes them and says which', async () => {
    add('a', 'app-pg', { 'kickjs.test': 'true', 'kickjs.test.name': 'app-pg' })
    expect((await run('down')).join('\n')).toContain('removed app-pg')
    expect(fake.removed).toEqual(['a'])
  })

  it("says Docker isn't reachable, and exits 1", async () => {
    fake.down = true
    expect((await run('ls')).join('\n')).toMatch(/Docker isn't reachable/)
    expect(process.exitCode).toBe(1)
  })
})
