import { resolve } from 'node:path'
import type { Command } from 'commander'
import { removeModule } from '../generators/remove-module'
import { loadKickConfig, resolveModuleConfig } from '../config'

export function registerRemoveCommand(program: Command): void {
  const remove = program.command('remove').alias('rm').description('Remove generated code')

  remove
    .command('module <name>')
    .description('Remove a module — deletes its directory and unregisters from modules/index.ts')
    .option('--modules-dir <dir>', 'Modules directory')
    .option('--no-pluralize', 'Use singular module name')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (name: string, opts: any) => {
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = opts.modulesDir ?? mc.dir ?? 'src/modules'
      const shouldPluralize = opts.pluralize === false ? false : (mc.pluralize ?? true)

      await removeModule({
        name,
        modulesDir: resolve(modulesDir),
        force: opts.force,
        pluralize: shouldPluralize,
      })
    })
}
