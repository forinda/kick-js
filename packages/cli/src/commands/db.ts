import path from 'node:path'
import type { Command } from 'commander'

import { writeFile } from 'node:fs/promises'

import {
  detectCompositeReferences,
  generate,
  migrateLatest,
  migrateUp,
  migrateDown,
  migrateRollback,
  migrateStatus,
  renderSchemaSource,
  type CompositeQueryRunner,
  type DbConfig,
  type MigrationAdapter,
} from '@forinda/kickjs-db'
import { loadKickConfig } from '../config'

interface BaseOpts {
  config: string
}

/**
 * Resolve the `db` block from `kick.config.ts` using the CLI's own jiti
 * loader (`loadKickConfig`) rather than `@forinda/kickjs-db`'s
 * `resolveDbConfig`, which does a native `import()` of the config file.
 *
 * Native ESM can't resolve the extensionless, relative TypeScript
 * imports a `kick.config.ts` commonly uses (e.g. `import { toolsPlugin }
 * from './tools/cli-plugin'` to mount a CLI plugin) — so any config that
 * imports local TS broke every `kick db` command with "Cannot find
 * module". jiti handles those exactly like the rest of the CLI does.
 */
async function loadConfig(opts: BaseOpts): Promise<DbConfig> {
  const startDir = path.dirname(path.resolve(process.cwd(), opts.config))
  const cfg = await loadKickConfig(startDir)
  const db = cfg?.db ?? {}
  return {
    schemaPath: db.schemaPath ?? 'src/db/schema.ts',
    migrationsDir: db.migrationsDir ?? 'db/migrations',
    dialect: db.dialect ?? 'postgres',
    connectionString: db.connectionString ?? process.env.DATABASE_URL,
    adapter: db.adapter as DbConfig['adapter'],
  }
}

/**
 * Resolve a MigrationAdapter from config:
 *  1. config.adapter() — explicit factory wins.
 *  2. config.connectionString — built-in pgAdapter path; we dynamically
 *     import @forinda/kickjs-db-pg + pg so the CLI doesn't pull pg into
 *     non-PG workflows.
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
      'kickjs-db: no adapter resolved — set db.connectionString (or DATABASE_URL) in kick.config.ts, or supply db.adapter() factory',
    )
  }
  const dialect = config.dialect ?? 'postgres'
  if (dialect !== 'postgres') {
    throw new Error(
      `kickjs-db: built-in CLI adapter only supports postgres in M1 (dialect=${dialect}); use db.adapter() factory for other dialects`,
    )
  }
  // Dynamic import so the CLI doesn't hard-require pg unless this path runs.
  // Both packages are devDependencies of @forinda/kickjs-cli so types resolve;
  // adopters who use this path must also install them in their own app.
  const [{ pgAdapter }, pg] = await Promise.all([import('@forinda/kickjs-db-pg'), import('pg')])
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

interface PgQueryRunnerProbe {
  runner: CompositeQueryRunner
  cleanup: () => Promise<void>
}

/**
 * Resolve a pg-protocol-compatible query runner for the M4.C
 * composite-type check at `kick db generate` time. Only fires for the
 * built-in pgAdapter path (dialect=postgres + connection string set):
 * the `db.adapter` factory escape hatch returns an opaque
 * MigrationAdapter, so we skip the check there.
 *
 * Returns null when detection is not wired (non-postgres dialect, no
 * connection string, or the adopter is using a custom adapter
 * factory). Adopters who need detection on a custom factory can call
 * `detectCompositeReferences` directly against their own pool.
 */
async function tryResolvePgQueryRunner(config: DbConfig): Promise<PgQueryRunnerProbe | null> {
  if (config.adapter) return null
  if ((config.dialect ?? 'postgres') !== 'postgres') return null
  if (!config.connectionString) return null

  const pg = await import('pg')
  const pool = new pg.default.Pool({ connectionString: config.connectionString })
  return {
    runner: pool,
    cleanup: async () => {
      await pool.end()
    },
  }
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

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database commands (kickjs-db)')

  db.command('generate <name>')
    .description('Generate a new migration from schema diff')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .option(
      '-e, --empty',
      'Skip schema diff and create an empty migration shell (data migration, seed, freeform SQL)',
    )
    .action(async (name: string, opts: BaseOpts & { empty?: boolean }) => {
      const cwd = process.cwd()
      const config = await loadConfig(opts)

      // M4.C — wire composite-type detection when we can resolve a PG pool
      // ourselves (built-in pgAdapter path, dialect=postgres, connection
      // string available). When the operator uses the `adapter` factory
      // escape hatch we skip the check — they can run
      // `detectCompositeReferences` manually if needed.
      const probe = await tryResolvePgQueryRunner(config)
      const detectCompositeRefs = probe
        ? (enumName: string) => detectCompositeReferences(probe.runner, enumName)
        : undefined

      try {
        const result = await generate({
          name,
          config,
          cwd,
          empty: opts.empty,
          detectCompositeRefs,
        })

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
  const migrate = db.command('migrate').description('Migration runner subcommands')

  migrate
    .command('latest')
    .description('Apply all pending migrations in a new batch')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .option(
      '--confirm-enum-drop',
      'Allow migrations carrying the `-- KICK ENUM REMOVE` header to apply',
      false,
    )
    .action(async (opts: BaseOpts & { confirmEnumDrop?: boolean }) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateLatest({
          adapter,
          migrationsDir: config.migrationsDir,
          confirmEnumDrop: opts.confirmEnumDrop,
        })
        if (r.applied.length === 0) {
          console.log('No pending migrations.')
        } else {
          console.log(`Applied batch ${r.batch}: ${r.applied.join(', ')}`)
        }
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('up')
    .description('Apply the next single pending migration')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .option(
      '--confirm-enum-drop',
      'Allow migrations carrying the `-- KICK ENUM REMOVE` header to apply',
      false,
    )
    .action(async (opts: BaseOpts & { confirmEnumDrop?: boolean }) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateUp({
          adapter,
          migrationsDir: config.migrationsDir,
          confirmEnumDrop: opts.confirmEnumDrop,
        })
        if (r.applied.length === 0) {
          console.log('No pending migrations.')
        } else {
          console.log(`Applied ${r.applied[0]} (batch ${r.batch})`)
        }
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('down')
    .description('Reverse the most recent applied migration')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (opts: BaseOpts) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateDown({ adapter, migrationsDir: config.migrationsDir })
        if (!r.reversed) {
          console.log('Nothing to reverse.')
        } else {
          console.log(`Reversed ${r.reversed}.`)
        }
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('rollback')
    .description('Reverse the entire last batch as a single unit')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (opts: BaseOpts) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateRollback({ adapter, migrationsDir: config.migrationsDir })
        if (r.reversed.length === 0) {
          console.log('Nothing to roll back.')
        } else {
          console.log(`Rolled back batch ${r.batch}: ${r.reversed.join(', ')}`)
        }
      } finally {
        await cleanup()
      }
    })

  migrate
    .command('status')
    .description('Print applied + pending migrations')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (opts: BaseOpts) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const status = await migrateStatus({ adapter, migrationsDir: config.migrationsDir })
        printStatusTable(status)
      } finally {
        await cleanup()
      }
    })

  // ── kick db introspect ─────────────────────────────────────────────────
  db.command('introspect')
    .description('Generate a TypeScript schema file from a live database')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .option('--out <path>', 'Output file (defaults to db.schemaPath from config)')
    .option('--json', 'Print the raw SchemaSnapshot JSON to stdout instead of writing TS source')
    .action(async (opts: BaseOpts & { out?: string; json?: boolean }) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const snapshot = await adapter.introspect()
        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2))
          return
        }
        const out = opts.out ?? config.schemaPath
        const source = renderSchemaSource(snapshot)
        await writeFile(out, source, 'utf8')
        const tableCount = Object.keys(snapshot.tables).length
        console.log(`Wrote ${out} (${tableCount} table${tableCount === 1 ? '' : 's'}).`)
      } finally {
        await cleanup()
      }
    })
}
