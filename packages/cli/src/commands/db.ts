import path from 'node:path'
import type { Command } from 'commander'

import {
  generate,
  resolveDbConfig,
  migrateLatest,
  migrateUp,
  migrateDown,
  migrateRollback,
  migrateStatus,
  type DbConfig,
  type MigrationAdapter,
} from '@forinda/kickjs-db'

interface BaseOpts {
  config: string
}

async function loadConfig(opts: BaseOpts): Promise<DbConfig> {
  return resolveDbConfig({ configPath: path.resolve(process.cwd(), opts.config) })
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
      const result = await generate({ name, config, cwd, empty: opts.empty })

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
    })

  // ── migrate runner subcommands ─────────────────────────────────────────
  const migrate = db.command('migrate').description('Migration runner subcommands')

  migrate
    .command('latest')
    .description('Apply all pending migrations in a new batch')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (opts: BaseOpts) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateLatest({ adapter, migrationsDir: config.migrationsDir })
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
    .action(async (opts: BaseOpts) => {
      const config = await loadConfig(opts)
      const { adapter, cleanup } = await resolveAdapter(config)
      try {
        const r = await migrateUp({ adapter, migrationsDir: config.migrationsDir })
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
}
