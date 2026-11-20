/**
 * A test file's own database on the suite's shared Postgres / MySQL
 * (`./services.ts`), shaped like the Testcontainers object the files used to
 * start: the same getters, and `stop()` drops the database.
 */
import { createMysqlTestDb, createPgTestDb } from '@forinda/kickjs-db/testing'

export interface SharedServer {
  getHost(): string
  getPort(): number
  getMappedPort(port?: number): number
  getDatabase(): string
  getUsername(): string
  getPassword(): string
  getRootPassword(): string
  getConnectionUri(root?: boolean): string
  /** Drop this file's database (the server stays up for the other files). */
  stop(): Promise<void>
}

function facade(connectionString: string, drop: () => Promise<void>): SharedServer {
  const url = new URL(connectionString)
  const port = Number(url.port)
  return {
    getHost: () => url.hostname,
    getPort: () => port,
    getMappedPort: () => port,
    getDatabase: () => decodeURIComponent(url.pathname.slice(1)),
    getUsername: () => decodeURIComponent(url.username),
    getPassword: () => decodeURIComponent(url.password),
    getRootPassword: () => decodeURIComponent(url.password),
    getConnectionUri: () => connectionString,
    stop: drop,
  }
}

const unavailable = (kind: string) =>
  new Error(
    `no shared ${kind} for this file: ${process.env.KICK_DB_SERVICES_ERROR ?? 'the suite globalSetup did not run'}`,
  )

/** A fresh, empty database on the shared Postgres. */
export async function sharedPostgres(): Promise<SharedServer> {
  if (!process.env.KICK_TEST_POSTGRES_URL) throw unavailable('Postgres')
  const t = await createPgTestDb({})
  return facade(t.connectionString, t.drop)
}

/** A fresh, empty database on the shared MySQL. */
export async function sharedMysql(): Promise<SharedServer> {
  if (!process.env.KICK_TEST_MYSQL_URL) throw unavailable('MySQL')
  const t = await createMysqlTestDb({})
  return facade(t.connectionString, t.drop)
}
