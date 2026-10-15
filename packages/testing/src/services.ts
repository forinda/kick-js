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

/** A running container and how to reach it. */
export interface StartedService {
  /** Connection URL, e.g. `postgres://test:test@127.0.0.1:55012/test`. */
  url: string
  host: string
  /** The host port mapped to the service's port. */
  port: number
  /** Stop and remove the container. Call it in `afterAll`. */
  stop(): Promise<void>
}

/** Any container — for services without a preset. */
export interface ContainerSpec {
  image: string
  /** The port the service listens on inside the container. */
  port: number
  env?: Record<string, string>
  /** Replace the image's entrypoint, e.g. `['sh']`. */
  entrypoint?: string[]
  /** Replace the image's command. */
  command?: string[]
  /** A log line that means "ready"; checked `times` times (default 1). */
  waitFor?: { log: RegExp; times?: number }
  /** Build the connection URL from the mapped host and port. */
  url: (host: string, port: number) => string
}

export interface ServiceOptions {
  /** Override the preset's image, e.g. `'postgres:16-alpine'`. */
  image?: string
}

const PRESETS = {
  postgres: {
    image: 'postgres:17-alpine',
    port: 5432,
    env: { POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' },
    // Postgres logs this once for its init run and again when really ready.
    waitFor: { log: /database system is ready to accept connections/, times: 2 },
    url: (host: string, port: number) => `postgres://test:test@${host}:${port}/test`,
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

export type ServiceKind = keyof typeof PRESETS

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

/** Start any container and return how to reach it. */
export async function startContainer(spec: ContainerSpec): Promise<StartedService> {
  const { GenericContainer, Wait } = await loadTestcontainers()
  let container = new GenericContainer(spec.image).withExposedPorts(spec.port)
  if (spec.env) container = container.withEnvironment(spec.env)
  if (spec.entrypoint) container = container.withEntrypoint(spec.entrypoint)
  if (spec.command) container = container.withCommand(spec.command)
  if (spec.waitFor) {
    container = container.withWaitStrategy(
      Wait.forLogMessage(spec.waitFor.log, spec.waitFor.times ?? 1),
    )
  }
  const started = await container.start()
  const host = started.getHost()
  const port = started.getMappedPort(spec.port)
  return {
    url: spec.url(host, port),
    host,
    port,
    stop: async () => {
      await started.stop()
    },
  }
}

/** Start a preset service — `'postgres'`, `'redis'` or `'minio'`. */
export function startService(
  kind: ServiceKind,
  options: ServiceOptions = {},
): Promise<StartedService> {
  const preset: ContainerSpec = PRESETS[kind]
  return startContainer({ ...preset, image: options.image ?? preset.image })
}
