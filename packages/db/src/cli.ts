/**
 * `@forinda/kickjs-db/cli` — the database command tree as a mountable CLI
 * plugin + the building blocks for a standalone `kickjs-db` bin.
 *
 * Two ways to use it:
 *  1. **As a kickjs-cli plugin** — add `dbCliPlugin` to `kick.config.ts`
 *     `plugins: []`. The host CLI calls `register(program, ctx)` and the
 *     db config is read from `ctx.config.db` (already loaded — no re-parse).
 *  2. **Standalone** — the `kickjs-db` bin builds a commander program,
 *     resolves config from `kickjs-db.config.ts` (or a `kick.config.ts`
 *     `db` block), and calls {@link registerDbCommands} directly. Lets
 *     `npx kickjs-db migrate latest` work without installing kickjs-cli.
 *
 * @module @forinda/kickjs-db/cli
 */

import { writeFile } from 'node:fs/promises'
import type { Command } from 'commander'

import { defineCliPlugin, type KickCliPlugin } from '@forinda/kickjs-cli-kit'
import { kickDbTypegen } from './cli-typegen'

export { kickDbTypegen } from './cli-typegen'

import {
  detectCompositeReferences,
  generate,
  migrateLatest,
  migrateUp,
  migrateDown,
  migrateRollback,
  migrateStatus,
  reviewMigration,
  renderSchemaSource,
  type CompositeQueryRunner,
  type DbConfig,
  type MigrationAdapter,
} from './index'
import type { Dialect } from './snapshot/types'
import type { MigrationAdapterFactory } from './cli/config'

/**
 * Authoring shape for the db config — every field optional, defaults
 * applied by {@link resolveKickDbConfig}. This is the same shape as the
 * `db` block in `kick.config.ts`, so a config authored with
 * `defineKickDbConfig` drops straight into either place.
 */
export interface KickDbConfigInput {
  schemaPath?: string
  migrationsDir?: string
  dialect?: Dialect
  connectionString?: string
  adapter?: MigrationAdapterFactory
}

/**
 * Identity helper for type inference — mirrors vite's `defineConfig`.
 * Use it in a standalone `kickjs-db.config.ts` (`export default
 * defineKickDbConfig({ ... })`) or as the value of `kick.config.ts`'s
 * `db` field. Both resolve through {@link resolveKickDbConfig}.
 */
export function defineKickDbConfig(cfg: KickDbConfigInput): KickDbConfigInput {
  return cfg
}

/**
 * Shallow-merge db configs, later wins (vite's `mergeConfig` spirit).
 * Lets a standalone `kickjs-db.config.ts` layer over a project's
 * `kick.config.ts` `db` block, or vice versa.
 */
export function mergeKickDbConfig(
  ...configs: (KickDbConfigInput | undefined)[]
): KickDbConfigInput {
  return Object.assign({}, ...configs.filter(Boolean))
}

/** Apply defaults to a {@link KickDbConfigInput}, yielding a resolved {@link DbConfig}. */
export function resolveKickDbConfig(block: KickDbConfigInput | undefined): DbConfig {
  const db = block ?? {}
  return {
    schemaPath: db.schemaPath ?? 'src/db/schema.ts',
    migrationsDir: db.migrationsDir ?? 'db/migrations',
    dialect: db.dialect ?? 'postgres',
    connectionString: db.connectionString ?? process.env.DATABASE_URL,
    adapter: db.adapter,
  }
}

/**
 * Resolve a MigrationAdapter from config:
 *  1. config.adapter() — explicit factory wins.
 *  2. config.connectionString — built-in pgAdapter path; dynamically
 *     imports `./pg` + `pg` so non-PG workflows don't pull pg.
 */
async function resolveAdapter(config: DbConfig): Promise<{
  adapter: MigrationAdapter
  cleanup: () => Promise<void>
}> {
  if (config.adapter) {
    const adapter = await config.adapter()
    return { adapter, cleanup: async () => adapter.close() }
  }
  if (!config.connectionString) {
    throw new Error(
      'kickjs-db: no adapter resolved — set db.connectionString (or DATABASE_URL), or supply a db.adapter() factory',
    )
  }
  const dialect = config.dialect ?? 'postgres'
  if (dialect !== 'postgres') {
    throw new Error(
      `kickjs-db: the built-in CLI adapter only supports postgres (dialect=${dialect}); supply a db.adapter() factory for other dialects`,
    )
  }
  // Dynamic import so we don't hard-require pg unless this path runs.
  const [{ pgAdapter }, pg] = await Promise.all([import('./pg'), import('pg')])
  const pool = new pg.default.Pool({ connectionString: config.connectionString })
  const adapter = pgAdapter({ pool })
  return {
    adapter,
    cleanup: async () => {
      await adapter.close()
      await pool.end()
    },
  }
}

/**
 * Drift detection introspects the live DB and compares it to the last
 * applied snapshot. All three adapters now implement `introspect()`, but
 * SQLite / MySQL introspection is lossy against a code-first snapshot (a
 * `uuid()` column reads back as `text` / `char(36)`), so comparing raw
 * would false-positive. Until a dialect-normalised compare lands, drift
 * stays off for those dialects; PostgreSQL (faithful round-trip) keeps
 * the default `'error'`.
 */
function driftCheckFor(config: DbConfig): 'ignore' | undefined {
  return (config.dialect ?? 'postgres') === 'postgres' ? undefined : 'ignore'
}

interface PgQueryRunnerProbe {
  runner: CompositeQueryRunner
  cleanup: () => Promise<void>
}

/**
 * Resolve a pg-protocol query runner for the composite-type check at
 * `generate` time. Only fires for the built-in pgAdapter path
 * (dialect=postgres + connection string, no custom adapter factory).
 */
async function tryResolvePgQueryRunner(config: DbConfig): Promise<PgQueryRunnerProbe | null> {
  if (config.adapter) return null
  if ((config.dialect ?? 'postgres') !== 'postgres') return null
  if (!config.connectionString) return null

  const pg = await import('pg')
  const pool = new pg.default.Pool({ connectionString: config.connectionString })
  return { runner: pool, cleanup: async () => void (await pool.end()) }
}

function printStatusTable(status: Awaited<ReturnType<typeof migrateStatus>>): void {
  if (status.length === 0) {
    console.log('No migrations.')
    return
  }
  console.table(
    status.map((s) => ({
      id: s.id,
      state: s.state,
      batch: s.batch ?? '-',
      reviewed: s.reviewed,
      applied: s.appliedAt ?? '-',
    })),
  )
}

/** A config source — resolved lazily so each command reads fresh config. */
export type DbConfigResolver = () => DbConfig | Promise<DbConfig>

/**
 * Attach the db commands (`generate`, `migrate *`, `introspect`) onto a
 * commander command. `parent` is the command they hang off — the plugin
 * passes a `db` subcommand (so `kick db generate`), the standalone bin
 * passes the root program (so `kickjs-db generate`). `getConfig` supplies
 * the resolved {@link DbConfig} — under kickjs-cli from `ctx.config.db`,
 * standalone from `kickjs-db.config.ts`.
 */
export function registerDbCommands(parent: Command, getConfig: DbConfigResolver): void {
  parent
    .command('generate <name>')
    .description('Generate a new migration from schema diff')
    .option(
      '-e, --empty',
      'Skip schema diff and create an empty migration shell (data migration, seed, freeform SQL)',
    )
    .action(async (name: string, opts: { empty?: boolean }) => {
      const cwd = process.cwd()
      const config = await getConfig()

      const probe = await tryResolvePgQueryRunner(config)
      const detectCompositeRefs = probe
        ? (enumName: string) => detectCompositeReferences(probe.runner, enumName)
        : undefined

      try {
        const result = await generate({ name, config, cwd, empty: opts.empty, detectCompositeRefs })
        if (result.status === 'no-changes') {
          console.log('No schema changes detected.')
          return
        }
        if (result.empty) {
          console.log(`Created empty migration ${result.migrationDir} (author up.sql + down.sql).`)
          return
        }
        const plural = result.changeCount === 1 ? '' : 's'
        console.log(
          `Created migration ${result.migrationDir} (${result.changeCount} change${plural}).`,
        )
      } finally {
        await probe?.cleanup()
      }
    })

  // ── migrate runner subcommands ─────────────────────────────────────────
  const migrate = parent.command('migrate').description('Migration runner subcommands')

  migrate
    .command('latest')
    .description('Apply all pending migrations in a new batch')
    .option(
      '--confirm-enum-drop',
      'Allow migrations carrying the `-- KICK ENUM REMOVE` header to apply',
      false,
    )
    .action(async (opts: { confirmEnumDrop?: boolean }) => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateLatest({
          adapter,
          migrationsDir: config.migrationsDir,
          confirmEnumDrop: opts.confirmEnumDrop,
          driftCheck: driftCheckFor(config),
        })
        console.log(
          r.applied.length === 0
            ? 'No pending migrations.'
            : `Applied batch ${r.batch}: ${r.applied.join(', ')}`,
        )
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('up')
    .description('Apply the next single pending migration')
    .option(
      '--confirm-enum-drop',
      'Allow migrations carrying the `-- KICK ENUM REMOVE` header to apply',
      false,
    )
    .action(async (opts: { confirmEnumDrop?: boolean }) => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateUp({
          adapter,
          migrationsDir: config.migrationsDir,
          confirmEnumDrop: opts.confirmEnumDrop,
          driftCheck: driftCheckFor(config),
        })
        console.log(
          r.applied.length === 0
            ? 'No pending migrations.'
            : `Applied ${r.applied[0]} (batch ${r.batch})`,
        )
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('down')
    .description('Reverse the most recent applied migration')
    .action(async () => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateDown({
          adapter,
          migrationsDir: config.migrationsDir,
          driftCheck: driftCheckFor(config),
        })
        console.log(r.reversed ? `Reversed ${r.reversed}.` : 'Nothing to reverse.')
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('rollback')
    .description('Reverse the entire last batch as a single unit')
    .action(async () => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateRollback({
          adapter,
          migrationsDir: config.migrationsDir,
          driftCheck: driftCheckFor(config),
        })
        console.log(
          r.reversed.length === 0
            ? 'Nothing to roll back.'
            : `Rolled back batch ${r.batch}: ${r.reversed.join(', ')}`,
        )
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('status')
    .description('Print applied + pending migrations')
    .action(async () => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        printStatusTable(await migrateStatus({ adapter, migrationsDir: config.migrationsDir }))
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('review <id>')
    .description('Mark a migration reviewed (flips meta.json + the -- REVIEWED markers)')
    .action(async (id: string) => {
      // No adapter/DB needed — review only touches the migration files.
      const config = await getConfig()
      const r = await reviewMigration(config.migrationsDir, id)
      console.log(
        r.alreadyReviewed
          ? `${r.id} was already reviewed.`
          : `Reviewed ${r.id} — it can now be applied.`,
      )
    })

  // ── kick db introspect ─────────────────────────────────────────────────
  parent
    .command('introspect')
    .description('Generate a TypeScript schema file from a live database')
    .option('--out <path>', 'Output file (defaults to db.schemaPath from config)')
    .option('--json', 'Print the raw SchemaSnapshot JSON to stdout instead of writing TS source')
    .action(async (opts: { out?: string; json?: boolean }) => {
      const config = await getConfig()
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const snapshot = await adapter.introspect()
        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2))
          return
        }
        const out = opts.out ?? config.schemaPath
        await writeFile(out, renderSchemaSource(snapshot), 'utf8')
        const n = Object.keys(snapshot.tables).length
        console.log(`Wrote ${out} (${n} table${n === 1 ? '' : 's'}).`)
      } finally {
        await cleanup()
      }
    })
}

/**
 * Read the `db` block off a host CLI config object. The kit types
 * `ctx.config` as `unknown`; the db block is structurally a
 * {@link KickDbConfigInput}.
 */
function dbBlockOf(config: unknown): KickDbConfigInput | undefined {
  return (config as { db?: KickDbConfigInput } | null)?.db
}

/**
 * The database CLI plugin. Mount it in `kick.config.ts`:
 *
 * ```ts
 * import { defineConfig } from '@forinda/kickjs-cli'
 * import { dbCliPlugin } from '@forinda/kickjs-db/cli'
 *
 * export default defineConfig({ plugins: [dbCliPlugin] })
 * ```
 *
 * `kick db generate|migrate|introspect` then read config from the
 * `db` block of the same `kick.config.ts`.
 */
export const dbCliPlugin: KickCliPlugin = defineCliPlugin({
  name: 'kick/db',
  register(program, ctx) {
    const db = program.command('db').description('Database commands (kickjs-db)')
    registerDbCommands(db, () => resolveKickDbConfig(dbBlockOf(ctx.config)))
  },
  // Mounting the plugin also wires `.kickjs/types/kick__db.d.ts` generation
  // into `kick typegen` — db commands + db types from one opt-in plugin.
  typegens: [kickDbTypegen()],
})
