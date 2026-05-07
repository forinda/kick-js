import { resolve } from 'node:path'
import type { Command } from 'commander'
import { loadKickConfig, resolveModuleConfig } from '../config'
import { migrateModulesDir, type MigrationTarget } from '../generators/migrate-modules'
import { colors } from '../utils/colors'
import { setDryRun } from '../utils/fs'

/** Read --dry-run from the parent `codemod` command's options. */
function isDryRun(cmd: Command): boolean {
  return (cmd.parent?.opts() as { dryRun?: boolean } | undefined)?.dryRun ?? false
}

interface CodemodModulesOpts {
  modulesDir?: string
  apply?: boolean
  experimental?: boolean
  target?: string
  backup?: boolean
}

/**
 * Register `kick codemod` and its subcommands. Distinct from
 * `kick db migrate` — that's the database-migration runner;
 * `kick codemod` is the AST-style codebase rewrite namespace.
 *
 * Currently exposes `kick codemod modules` (experimental) which
 * rewrites between the two module declaration shapes:
 *
 *   - `class FooModule implements AppModule { ... }` (legacy)
 *   - `defineModule({ name, build: () => ({...}) })`  (factory)
 *
 * Direction defaults to whatever `kick.config.ts > modules.style`
 * resolves to (or `'define'` when unset). Override with
 * `--target define|class`.
 */
export function registerCodemodCommands(program: Command): void {
  const codemod = program
    .command('codemod')
    .description('Codebase migration commands (AST-style rewrites — distinct from db migrate)')

  codemod
    .command('modules')
    .description(
      'Rewrite module declarations between class form and the defineModule factory.\n' +
        '  Direction defaults to `modules.style` from kick.config (or "define").\n' +
        '  --target define|class  Override the migration direction.\n' +
        '  --apply                Apply the changes (default: dry-run preview).\n' +
        '  --experimental         Acknowledge that AST migration is experimental.',
    )
    .option('--modules-dir <dir>', 'Modules directory (default: src/modules from kick.config)')
    .option('--apply', 'Apply the migration to disk (default: dry-run)')
    .option('--experimental', 'Acknowledge that this command is experimental')
    .option('--target <style>', "Migration direction — 'define' or 'class'")
    .option('--no-backup', 'Skip the .kickjs/codemod-backups/ snapshot (default: backup on)')
    .action(async (opts: CodemodModulesOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd) || !opts.apply
      setDryRun(dryRun)

      if (!opts.experimental) {
        console.error(
          '\n  ' +
            colors.red('Error:') +
            ' kick codemod modules is experimental — pass --experimental to acknowledge.\n' +
            '  The regex-based rewrite handles the shapes our templates produce.\n' +
            '  Hand-rolled modules with non-standard structures may be skipped.\n' +
            '  Always commit before running with --apply.\n',
        )
        process.exit(1)
      }

      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = resolve(opts.modulesDir ?? mc.dir ?? 'src/modules')

      // Resolution order: --target flag > kick.config modules.style > 'define'
      let target: MigrationTarget
      if (opts.target === 'define' || opts.target === 'class') {
        target = opts.target
      } else if (opts.target !== undefined) {
        console.error(
          `\n  ${colors.red('Error:')} --target must be 'define' or 'class' (got '${opts.target}').\n`,
        )
        process.exit(1)
      } else {
        target = mc.style ?? 'define'
      }

      const arrow = colors.dim(`→ ${target}`)
      const modeLabel = dryRun ? colors.dim('(dry-run)') : colors.bold('(applying)')
      console.log(`\n  ${colors.bold('kick codemod modules')} ${arrow} ${modeLabel}`)
      console.log(`  modulesDir: ${colors.dim(modulesDir)}\n`)

      // Backup defaults to ON when applying. `--no-backup` flips to
      // false (commander wires `--no-X` automatically). Dry-run skips
      // the backup since nothing's being rewritten.
      const backup = opts.backup !== false && !dryRun
      const result = await migrateModulesDir(modulesDir, { dryRun, target, backup })

      if (result.backupDir) {
        const backupRel = result.backupDir
        console.log(
          `  ${colors.green('✓')} backup: ${colors.dim(backupRel)}\n` +
            `    ${colors.dim('(restore: rm -rf <modulesDir> && mv "<backup>" <modulesDir>)')}\n`,
        )
      } else if (!dryRun && opts.backup === false) {
        console.log(`  ${colors.dim('(--no-backup — skipping snapshot)')}\n`)
      }

      let migrated = 0
      let skipped = 0
      for (const file of result.files) {
        if (file.status === 'migrated') {
          migrated++
          console.log(`    ${colors.green('✓')} ${file.path}`)
        } else {
          skipped++
          const reasonLabel = colors.dim(`(${file.reason ?? 'skipped'})`)
          console.log(`    ${colors.dim('-')} ${file.path} ${reasonLabel}`)
        }
      }

      console.log()
      if (result.indexStatus === 'migrated') {
        console.log(`    ${colors.green('✓')} ${result.indexPath}`)
      } else if (result.indexStatus === 'skipped') {
        const reasonLabel = colors.dim(`(${result.indexReason ?? 'skipped'})`)
        console.log(`    ${colors.dim('-')} ${result.indexPath} ${reasonLabel}`)
      } else {
        console.log(`    ${colors.dim('-')} ${result.indexPath} ${colors.dim('(not found)')}`)
      }

      const dryNote = dryRun ? colors.dim(' (dry-run — pass --apply to write)') : ''
      console.log(
        `\n  ${colors.bold(String(migrated))} migrated, ${colors.bold(String(skipped))} skipped${dryNote}\n`,
      )
    })
}
