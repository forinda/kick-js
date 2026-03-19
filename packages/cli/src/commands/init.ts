import { resolve } from 'node:path'
import type { Command } from 'commander'
import { initProject } from '../generators/project'

export function registerInitCommand(program: Command): void {
  program
    .command('new <name>')
    .alias('init')
    .description('Create a new KickJS project')
    .option('-d, --directory <dir>', 'Target directory (defaults to project name)')
    .option('--pm <manager>', 'Package manager: pnpm | npm | yarn', 'pnpm')
    .action(async (name: string, opts: any) => {
      const directory = resolve(opts.directory || name)
      await initProject({
        name,
        directory,
        packageManager: opts.pm,
      })
    })
}
