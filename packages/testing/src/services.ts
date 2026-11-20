/**
 * Real backing services for tests — a Postgres, a Redis, a MinIO — started in Docker
 * through Testcontainers, handing back the connection details to give the app:
 *
 * ```ts
 * const pg = await startService('postgres')
 * afterAll(() => pg.stop())
 *
 * const { app } = await createTestApp({
 *   modules,
 *   settings: [DbSettings.provide({ url: pg.url })],
 * })
 * ```
 *
 * Needs Docker and the `testcontainers` package (an optional peer).
 *
 * @module @forinda/kickjs-testing/services
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

/** A running container and how to reach it. */
export interface StartedService {
  /** Connection URL, e.g. `postgres://test:test@127.0.0.1:55012/test`. */
  url: string
  host: string
  /** The host port mapped to the service's port. */
  port: number
  /** Attached to a container a previous run left up (it stays up: `stop()` leaves it). */
  reused: boolean
  /** Stop and remove the container; a no-op for a reused one. Call it in `afterAll`. */
  stop(): Promise<void>
}

/** Naming a container, and keeping it for the next run. */
export interface ReuseOptions {
  /**
   * The container's name. A named container is reused: the next run attaches
   * to it instead of starting another, so a machine keeps one per name.
   */
  name?: string
  /**
   * `'local'` (the default with a `name`): reuse, except when `CI` is set, so
   * every CI run starts clean. `true`: always. `false`: never.
   */
  reuse?: boolean | 'local'
}

/** Every container these helpers start carries this label (`kick test:services` finds them by it). */
export const TEST_LABEL = 'kickjs.test'
const NAME_LABEL = 'kickjs.test.name'
const CONFIG_LABEL = 'kickjs.test.config'

/** Whether a container named `name` is reused, given `reuse` and the environment. */
export function reuseEnabled(
  reuse: boolean | 'local' | undefined,
  name: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!name) return false
  if (reuse === undefined || reuse === 'local') return !env.CI
  return reuse
}

/** Any container — for services without a preset. */
export interface ContainerSpec extends ReuseOptions {
  image: string
  /** The port the service listens on inside the container. */
  port: number
  env?: Record<string, string>
  /** Replace the image's entrypoint, e.g. `['sh']`. */
  entrypoint?: string[]
  /** Replace the image's command. */
  command?: string[]
  /** Folders kept in memory, e.g. a database's data directory: `{ '/var/lib/mysql': 'rw' }`. */
  tmpfs?: Record<string, string>
  /** A log line that means "ready"; checked `times` times (default 1). */
  waitFor?: { log: RegExp; times?: number }
  /** Build the connection URL from the mapped host and port (and the container's env). */
  url: (host: string, port: number, env: Record<string, string>) => string
  /**
   * A fixed host port instead of a random one — for a tool outside the tests
   * that needs a known port. Two runs at once (or a reused container from an
   * older config) then clash on it; leave it random unless you need it.
   */
  hostPort?: number
}

/**
 * Options for {@link startService}.
 *
 * @see https://kickjs.app/guide/testing/large-suites
 */
export interface ServiceOptions extends ReuseOptions {
  /** Override the preset's image, e.g. `'postgres:16-alpine'`. */
  image?: string
  /** Merged over the preset's env; the URL follows (user, password, database). */
  env?: Record<string, string>
  /** Replaces the preset's command (the Postgres/MySQL presets' tuning flags go with it). */
  command?: string[]
  /** `false` keeps the data directory on disk; a map replaces the preset's in-memory folders. */
  tmpfs?: false | Record<string, string>
  /** A fixed host port (see {@link ContainerSpec.hostPort}). */
  hostPort?: number
}

const PRESETS = {
  postgres: {
    image: 'postgres:17-alpine',
    port: 5432,
    env: { POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' },
    // Postgres logs this once for its init run and again when really ready.
    waitFor: { log: /database system is ready to accept connections/, times: 2 },
    url: (host: string, port: number, env: Record<string, string>) =>
      `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${host}:${port}/${env.POSTGRES_DB}`,
    // Test data never has to survive a crash: memory, and no waiting on disk.
    tmpfs: { '/var/lib/postgresql/data': 'rw' },
    command: [
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ],
  },
  mysql: {
    image: 'mysql:8.4',
    port: 3306,
    // Root: per-file test databases need CREATE / DROP DATABASE.
    env: { MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'test' },
    // The init run logs "ready for connections" on port 0; the real server on 3306.
    waitFor: { log: /ready for connections.*port: 3306/ },
    url: (host: string, port: number, env: Record<string, string>) =>
      `mysql://root:${env.MYSQL_ROOT_PASSWORD}@${host}:${port}/${env.MYSQL_DATABASE}`,
    tmpfs: { '/var/lib/mysql': 'rw' },
    command: ['--innodb-flush-log-at-trx-commit=0', '--sync-binlog=0'],
  },
  redis: {
    image: 'redis:7-alpine',
    port: 6379,
    waitFor: { log: /Ready to accept connections/ },
    url: (host: string, port: number) => `redis://${host}:${port}`,
  },
  // S3-compatible, with an empty `test` bucket (a top-level folder is a
  // bucket to MinIO). Credentials `minioadmin` / `minioadmin`.
  minio: {
    image: 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z',
    port: 9000,
    entrypoint: ['sh'],
    command: ['-c', 'mkdir -p /data/test && exec minio server /data'],
    waitFor: { log: /API: http/ },
    url: (host: string, port: number) => `http://${host}:${port}`,
  },
} satisfies Record<string, ContainerSpec>

/** A preset service for {@link startService}: `'postgres'`, `'redis'` or `'minio'`. */
export type ServiceKind = keyof typeof PRESETS

/** The preset services, by kind. */
export const SERVICE_PRESETS: Readonly<Record<ServiceKind, ContainerSpec>> = PRESETS

type Testcontainers = typeof import('testcontainers')

async function loadTestcontainers(): Promise<Testcontainers> {
  try {
    return await import('testcontainers')
  } catch {
    throw new Error(
      "@forinda/kickjs-testing: starting services needs the 'testcontainers' package and Docker. " +
        'Install it: pnpm add -D testcontainers',
    )
  }
}

/**
 * What a container is, for "is the one with this name the same?" — a short
 * hash. The Testcontainers version is part of it: its own reuse hash changes
 * with the version, so an upgrade must count as a new config.
 */
export function configOf(spec: ContainerSpec, testcontainersVersion: string): string {
  const { image, port, env, entrypoint, command, tmpfs, hostPort } = spec
  return createHash('sha256')
    .update(
      JSON.stringify({
        image,
        port,
        env,
        entrypoint,
        command,
        tmpfs,
        hostPort,
        testcontainersVersion,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

/**
 * Make room for a named container: one with the same config is left for
 * Testcontainers to attach to; a stopped one with another config is removed;
 * a running one with another config may be another run's, so it's an error.
 */
async function clearName(tc: Testcontainers, name: string, config: string): Promise<void> {
  const client = await tc.getContainerRuntimeClient()
  const docker = (
    client.container as unknown as {
      dockerode: {
        listContainers(
          o: object,
        ): Promise<
          Array<{ Id: string; Image?: string; Labels?: Record<string, string>; State?: string }>
        >
      }
    }
  ).dockerode
  const [found] = await docker.listContainers({
    all: true,
    filters: { label: [`${NAME_LABEL}=${name}`] },
  })
  if (!found || found.Labels?.[CONFIG_LABEL] === config) return
  if (found.State === 'running') {
    throw new Error(
      `@forinda/kickjs-testing: ${name} is running with another config (image ${found.Image ?? '?'}): ` +
        `stop it with \`kick test:services down ${name}\`, or give this suite another name`,
    )
  }
  await client.container.remove(client.container.getById(found.Id), { removeVolumes: true })
  console.warn(`@forinda/kickjs-testing: replacing ${name} (config changed)`)
}

/** Another run holds the name, or started the container a moment ago (Docker's 409 / 304). */
const isNameConflict = (err: unknown) =>
  /already in use|Conflict|already started|304/i.test(String((err as Error)?.message))

/**
 * Start any container and return how to reach it. With a `name` it's reused:
 * a later run attaches to it (see {@link ReuseOptions}).
 */
export async function startContainer(spec: ContainerSpec): Promise<StartedService> {
  const tc = await loadTestcontainers()
  const { GenericContainer, Wait } = tc
  const reused = reuseEnabled(spec.reuse, spec.name)
  const config = configOf(spec, testcontainersVersion())
  // A fresh builder per attempt: start() changes a builder (it adds the reuse
  // hash to its labels), so a second start() on it would never find the
  // container another run just created.
  const build = () => {
    let container = new GenericContainer(spec.image)
      .withExposedPorts(spec.hostPort ? { container: spec.port, host: spec.hostPort } : spec.port)
      .withLabels({
        [TEST_LABEL]: 'true',
        [CONFIG_LABEL]: config,
        ...(reused ? { [NAME_LABEL]: spec.name! } : {}),
      })
    if (spec.env) container = container.withEnvironment(spec.env)
    if (spec.entrypoint) container = container.withEntrypoint(spec.entrypoint)
    if (spec.command) container = container.withCommand(spec.command)
    if (spec.tmpfs) container = container.withTmpFs(spec.tmpfs)
    if (reused) {
      // A restarted container's old logs already say "ready": wait for its port.
      return container.withName(spec.name!).withReuse().withWaitStrategy(Wait.forListeningPorts())
    }
    if (spec.waitFor) {
      container = container.withWaitStrategy(
        Wait.forLogMessage(spec.waitFor.log, spec.waitFor.times ?? 1),
      )
    }
    return container
  }
  if (reused) await clearName(tc, spec.name!, config)
  const started = await startWithRetry(build, reused)
  const host = started.getHost()
  const port = started.getMappedPort(spec.port)
  return {
    url: spec.url(host, port, spec.env ?? {}),
    host,
    port,
    reused,
    stop: async () => {
      if (!reused) await started.stop()
    },
  }
}

/**
 * Start, and when another run is creating (or starting) the same named
 * container at that moment, try again with a fresh builder — which then
 * finds that container and attaches to it.
 */
async function startWithRetry(
  build: () => InstanceType<Testcontainers['GenericContainer']>,
  reused: boolean,
  attempts = 3,
): Promise<import('testcontainers').StartedTestContainer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await build().start()
    } catch (err) {
      if (!reused || attempt >= attempts || !isNameConflict(err)) throw err
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
}

/** The installed Testcontainers' version (`'unknown'` when it can't be read). */
function testcontainersVersion(): string {
  try {
    return (createRequire(import.meta.url)('testcontainers/package.json') as { version: string })
      .version
  } catch {
    return 'unknown'
  }
}

/** Start a preset service — `'postgres'`, `'mysql'`, `'redis'` or `'minio'`. */
export function startService(
  kind: ServiceKind,
  options: ServiceOptions = {},
): Promise<StartedService> {
  const preset: ContainerSpec = PRESETS[kind]
  return startContainer({
    ...preset,
    image: options.image ?? preset.image,
    env: preset.env || options.env ? { ...preset.env, ...options.env } : undefined,
    command: options.command ?? preset.command,
    tmpfs: options.tmpfs === false ? undefined : (options.tmpfs ?? preset.tmpfs),
    hostPort: options.hostPort,
    name: options.name,
    reuse: options.reuse,
  })
}
