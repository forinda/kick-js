import { resolve } from 'node:path'
import type { Command } from 'commander'
import { removeModule } from '../generators/remove-module'
import { loadKickConfig, resolveModuleConfig } from '../config'

export function registerRemoveCommand(program: Command): void {
  const remove = program.command('remove').alias('rm').description('Remove generated code')

  remove
    .command('module <names...>')
    .description('Remove one or more modules (e.g. kick rm module user task)')
    .option('--modules-dir <dir>', 'Modules directory')
    .option('--no-pluralize', 'Use singular module name')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (names: string[], opts: any) => {
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = opts.modulesDir ?? mc.dir ?? 'src/modules'
      const shouldPluralize = opts.pluralize === false ? false : (mc.pluralize ?? true)

      for (const name of names) {
        await removeModule({
          name,
          modulesDir: resolve(modulesDir),
          force: opts.force,
          pluralize: shouldPluralize,
        })
      }
    })
}
