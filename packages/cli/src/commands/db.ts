import path from 'node:path'
import type { Command } from 'commander'

import { generate, resolveDbConfig } from '@forinda/kickjs-db'

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database commands (kickjs-db)')

  db.command('generate <name>')
    .description('Generate a new migration from schema diff')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .option(
      '-e, --empty',
      'Skip schema diff and create an empty migration shell (data migration, seed, freeform SQL)',
    )
    .action(async (name: string, opts: { config: string; empty?: boolean }) => {
      const cwd = process.cwd()
      const config = await resolveDbConfig({ configPath: path.resolve(cwd, opts.config) })
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
}
