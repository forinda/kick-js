import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Kysely } from 'kysely'
import { loadModule } from '../cli/load-module'
import type { MigrationAdapter, MigrationRow } from './adapter'

/** What a migration written in TypeScript runs with: Kysely on the migration's transaction. */
export type MigrationDb = Kysely<any>

/** A migration's code, from its `migration.ts`. */
export interface CodeMigration {
  up(db: MigrationDb): Promise<void>
  down?(db: MigrationDb): Promise<void>
}

/** The file names a migration's code may have, in the order they're looked for. */
export const CODE_MIGRATION_FILES = [
  'migration.ts',
  'migration.mts',
  'migration.js',
  'migration.mjs',
]

/** The migration's code file, if it has one. */
export function codeMigrationFile(dir: string): string | undefined {
  return CODE_MIGRATION_FILES.map((f) => path.join(dir, f)).find((f) => existsSync(f))
}

async function load(file: string, id: string): Promise<CodeMigration> {
  const mod = (await loadModule(file, { fresh: true })) as Partial<CodeMigration>
  if (typeof mod.up !== 'function') {
    throw new Error(`migration ${id}: ${path.basename(file)} must export an async up(db)`)
  }
  return mod as CodeMigration
}

/**
 * Run a migration's `up` or `down`, and its bookkeeping. In a transaction
 * the `kick_migrations` row is written on the same one, so the code and its
 * record commit or roll back together.
 */
export async function runCodeMigration(
  file: string,
  id: string,
  direction: 'up' | 'down',
  adapter: MigrationAdapter,
  useTx: boolean,
  bookkeeping: { record: Omit<MigrationRow, 'appliedAt'> } | { remove: string },
): Promise<void> {
  const migration = await load(file, id)
  const run = direction === 'up' ? migration.up : migration.down
  if (!run) throw new Error(`migration ${id}: ${path.basename(file)} has no down(db) to reverse it`)
  const db = adapter.kysely?.()
  if (!db) {
    throw new Error(
      `migration ${id} is written in TypeScript, and this migration adapter has no kysely() to run it with`,
    )
  }

  const record = async (exec: MigrationDb) => {
    if ('record' in bookkeeping) {
      await exec.insertInto('kick_migrations').values(bookkeeping.record).execute()
    } else {
      await exec.deleteFrom('kick_migrations').where('id', '=', bookkeeping.remove).execute()
    }
  }

  if (useTx) {
    await db.transaction().execute(async (trx) => {
      await run.call(migration, trx)
      await record(trx)
    })
  } else {
    await run.call(migration, db)
    await record(db)
  }
}
