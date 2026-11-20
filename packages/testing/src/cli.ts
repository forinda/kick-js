/**
 * `kick test:services`: the test containers these helpers started and left up
 * for the next run (named, reused ones), and a way to remove them. Only
 * containers labelled `kickjs.test` are ever listed or removed.
 *
 * ```ts
 * // kick.config.ts
 * import { testServicesCliPlugin } from '@forinda/kickjs-testing/cli'
 * export default defineConfig({ plugins: [testServicesCliPlugin] })
 * ```
 *
 * @module @forinda/kickjs-testing/cli
 */
import type { KickCliPlugin } from '@forinda/kickjs-cli-kit'
import { TEST_LABEL } from './services'

/** A test container, as `kick test:services ls` shows it. */
export interface TestContainer {
  id: string
  name: string
  image: string
  state: string
  /** Seconds since the epoch. */
  created: number
  /** The host port, when it's running. */
  port?: number
}

interface DockerList {
  listContainers(o: object): Promise<
    Array<{
      Id: string
      Names?: string[]
      Image: string
      State: string
      Created: number
      Labels?: Record<string, string>
      Ports?: Array<{ PublicPort?: number }>
    }>
  >
}

async function docker() {
  let tc: typeof import('testcontainers')
  try {
    tc = await import('testcontainers')
  } catch {
    throw new Error(
      "kick test:services needs the 'testcontainers' package: pnpm add -D testcontainers",
    )
  }
  try {
    const client = await tc.getContainerRuntimeClient()
    return { client, list: (client.container as unknown as { dockerode: DockerList }).dockerode }
  } catch (err) {
    throw new Error(`Docker isn't reachable: ${(err as Error).message}`, { cause: err })
  }
}

/** Every container labelled `kickjs.test`, running or stopped. */
export async function listTestContainers(): Promise<TestContainer[]> {
  const { list } = await docker()
  const found = await list.listContainers({ all: true, filters: { label: [`${TEST_LABEL}=true`] } })
  return found.map((c) => ({
    id: c.Id,
    name: c.Labels?.[`${TEST_LABEL}.name`] ?? c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    created: c.Created,
    port: c.Ports?.find((p) => p.PublicPort)?.PublicPort,
  }))
}

/** Remove test containers (all, or those `names`) with their volumes; the names removed. */
export async function removeTestContainers(names?: string[]): Promise<string[]> {
  const { client } = await docker()
  const wanted = (await listTestContainers()).filter(
    (c) => !names?.length || names.includes(c.name),
  )
  for (const c of wanted) {
    const container = client.container.getById(c.id)
    if (c.state === 'running') await client.container.stop(container)
    await client.container.remove(container, { removeVolumes: true })
  }
  return wanted.map((c) => c.name)
}

const age = (created: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - created))
  return s < 3600
    ? `${Math.round(s / 60)}m`
    : s < 86_400
      ? `${Math.round(s / 3600)}h`
      : `${Math.round(s / 86_400)}d`
}

/** The `kick test:services` commands. */
export const testServicesCliPlugin: KickCliPlugin = {
  name: 'kick/test-services',
  register(program, ctx) {
    const services = program
      .command('test:services')
      .description('Test containers left up for the next run (named, reused ones)')
    const run = (fn: () => Promise<void>) => async () => {
      try {
        await fn()
      } catch (err) {
        ctx.log((err as Error).message)
        process.exitCode = 1
      }
    }
    services
      .command('ls')
      .description('List test containers (labelled kickjs.test)')
      .action(
        run(async () => {
          const all = await listTestContainers()
          if (!all.length) return ctx.log('no test containers')
          for (const c of all) {
            ctx.log(
              `${c.name}  ${c.image}  ${c.state}  ${age(c.created)}${c.port ? `  :${c.port}` : ''}`,
            )
          }
        }),
      )
    services
      .command('down [names...]')
      .description('Stop and remove test containers (all, or those named)')
      .action((names: string[]) =>
        run(async () => {
          const removed = await removeTestContainers(names)
          ctx.log(
            removed.length ? removed.map((n) => `removed ${n}`).join('\n') : 'no test containers',
          )
        })(),
      )
  },
}
