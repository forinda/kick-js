// Singleton Postgres pool + KickDbClient wired into KickJS DI.
//
// One pool serves both:
//   - the migration adapter (used by kickDbAdapter on boot + the CLI)
//   - the query client (registered under DB_PRIMARY for repositories)
//
// On bootstrap, kickDbAdapter calls migrationAdapter.close() during shutdown
// — that's a no-op (caller-owned pool), so we close the pool ourselves below.

import { Pool } from 'pg'
import { PostgresDialect } from 'kysely'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // Don't throw here at import time — let the actual pool() invocation throw
  // so `kick build` / typegen / format don't fail when DATABASE_URL is unset.
}

export const pool = new Pool({ connectionString })

// No explicit DB generic — SchemaToKysely<typeof schema> is inferred end-to-end.
// Adopters who want to widen `KickDbClient` (no generic) globally to this
// shape declare the KickDbRegister augmentation in ./register.ts.
export const dbClient = createDbClient({
  schema,
  dialect: new PostgresDialect({ pool }),
  events: true,
})

export const migrationAdapter = pgAdapter({ pool })

export type Db = typeof dbClient

export { schema }
