import path from 'node:path'
import type { Command } from 'commander'

import { generate, resolveDbConfig } from '@forinda/kickjs-db'

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database commands (kickjs-db)')

  db.command('generate <name>')
    .description('Generate a new migration from schema diff')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (name: string, opts: { config: string }) => {
      const cwd = process.cwd()
      const config = await resolveDbConfig({ configPath: path.resolve(cwd, opts.config) })
      const result = await generate({ name, config, cwd })

      if (result.status === 'no-changes') {
        console.log('No schema changes detected.')
        return
      }
      const plural = result.changeCount === 1 ? '' : 's'
      console.log(
        `Created migration ${result.migrationDir} (${result.changeCount} change${plural}).`,
      )
    })
}
