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
import { createDbClient, type KickDbClient } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

import * as schema from './schema'

interface Schema {
  users: {
    id: string
    email: string
    firstName: string
    lastName: string
    avatarUrl: string | null
    isActive: boolean
    createdAt: Date | string
  }
  workspaces: {
    id: string
    name: string
    slug: string
    description: string | null
    ownerId: string
    createdAt: Date | string
  }
  tasks: {
    id: string
    workspaceId: string
    title: string
    description: string | null
    status: string
    priority: string
    estimatePoints: number | null
    metadata: { tags?: string[]; customFields?: Record<string, string> } | null
    createdAt: Date | string
  }
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  // Don't throw here at import time — let the actual pool() invocation throw
  // so `kick build` / typegen / format don't fail when DATABASE_URL is unset.
}

export const pool = new Pool({ connectionString })

export const dbClient: KickDbClient<Schema> = createDbClient<typeof schema, Schema>({
  schema,
  dialect: new PostgresDialect({ pool }),
  events: true,
})

export const migrationAdapter = pgAdapter({ pool })

export type Db = typeof dbClient

export { schema }
