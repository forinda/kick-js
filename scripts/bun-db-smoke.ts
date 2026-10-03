/**
 * kick/db on `bun:sqlite` (D.23): migrations through `sqliteAdapter` and
 * queries through `sqliteDialect`, both on Bun's own SQLite. Run after
 * `pnpm build`:
 *
 *   bun scripts/bun-db-smoke.ts
 */
import { Database } from 'bun:sqlite'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
} from '../packages/db/dist/index.mjs'
import { sqliteAdapter, sqliteDialect } from '../packages/db/dist/sqlite.mjs'

const users = table('users', { id: serial().primaryKey(), email: text().notNull() })
const schema = { users }

const database = new Database(':memory:')
const adapter = sqliteAdapter({ database: database as never })
await adapter.ensureMigrationTables()
const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
await adapter.applyMigrationInTx!(emitSqlite(diff(empty, extractSnapshot(schema, 'sqlite'))), {
  record: { id: 'init', name: 'init', hash: 'h', batch: 1, direction: 'up' },
})

const db = createDbClient({ schema, dialect: sqliteDialect({ database: database as never }) })
await db.insertInto('users').values({ email: 'ada@x.io' }).execute()
const rows = await db.selectFrom('users').selectAll().execute()
const live = await adapter.introspect()

const ok =
  rows.length === 1 &&
  rows[0].email === 'ada@x.io' &&
  (await adapter.listApplied()).length === 1 &&
  'users' in live.tables
if (!ok) {
  console.error('bun:sqlite smoke failed', { rows, tables: Object.keys(live.tables) })
  process.exit(1)
}
console.log('kick/db on bun:sqlite: migrate, insert, select, introspect — ok')
