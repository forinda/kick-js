/**
 * `kick typegen` — generate type-safe DI registry and module manifests
 * inside `.kickjs/types/`. Mirrors the React Router `.react-router/types/`
 * pattern.
 *
 * Usage:
 *   kick typegen          # one-shot
 *   kick typegen --watch  # rebuild on file changes
 */

import type { Command } from 'commander'
import { runTypegen, TokenCollisionError, watchTypegen } from '../typegen'
import { runTypegen as runPluginTypegens } from '../typegen/runner'
import { loadKickConfig } from '../config'
import { mergeCliPlugins } from '../plugin'
import { builtinCliPlugins } from '../plugin/builtins'

interface TypegenCliOptions {
  watch?: boolean
  src: string
  out: string
  silent?: boolean
  allowDuplicates?: boolean
  schemaValidator?: string
  envFile?: string
  check?: boolean
}

/**
 * Parse the `--schema-validator` CLI flag. Returns `undefined` if the
 * flag was not passed (so the config default applies), `'zod'` if a
 * supported value was passed, or `false` if explicitly disabled.
 */
function parseSchemaValidatorFlag(value: string | undefined): 'zod' | false | undefined {
  if (value === undefined) return undefined
  if (value === 'false' || value === 'off' || value === 'none') return false
  if (value === 'zod') return 'zod'
  console.warn(
    `  kick typegen: unknown --schema-validator '${value}' (only 'zod' and 'false' are supported). ` +
      `Falling back to project config.`,
  )
  return undefined
}

/**
 * Parse the `--env-file` CLI flag. Returns `undefined` to fall through
 * to the config default, `false` when the user disables env typing
 * with `--env-file false`, or the literal path string otherwise.
 */
function parseEnvFileFlag(value: string | undefined): string | false | undefined {
  if (value === undefined) return undefined
  if (value === 'false' || value === 'off' || value === 'none') return false
  return value
}

export function registerTypegenCommand(program: Command): void {
  program
    .command('typegen')
    .description('Generate type-safe DI registry and module types into .kickjs/types/')
    .option('-w, --watch', 'Watch source files and regenerate on change')
    .option('-s, --src <dir>', 'Source directory to scan', 'src')
    .option('-o, --out <dir>', 'Output directory', '.kickjs/types')
    .option('--silent', 'Suppress output')
    .option(
      '--allow-duplicates',
      'Auto-namespace duplicate class names instead of failing (use with caution)',
    )
    .option(
      '--schema-validator <name>',
      "Schema validator for body/query/params typing (currently 'zod' or 'false')",
    )
    .option(
      '--env-file <path>',
      "Path to env schema file for KickEnv typing (default 'src/env.ts'; pass 'false' to disable)",
    )
    .option('--check', 'CI gate: fail on plugin-typegen drift instead of writing')
    .action(async (opts: TypegenCliOptions) => {
      const cwd = process.cwd()

      // CLI flag wins over kick.config.ts; the config sets the project default.
      const config = await loadKickConfig(cwd)
      const cliValidator = parseSchemaValidatorFlag(opts.schemaValidator)
      const schemaValidator = cliValidator ?? config?.typegen?.schemaValidator ?? 'zod'
      const envFile = parseEnvFileFlag(opts.envFile) ?? config?.typegen?.envFile

      const baseOpts = {
        cwd,
        srcDir: opts.src ?? config?.typegen?.srcDir,
        outDir: opts.out ?? config?.typegen?.outDir,
        silent: opts.silent,
        allowDuplicates: opts.allowDuplicates,
        schemaValidator,
        envFile,
        // Asset typegen (assets-plan.md PR 4) — drives `KickAssets`
        // augmentation generation. No-op when assetMap is empty.
        assetMap: config?.assetMap,
      }

      try {
        if (opts.watch) {
          const stop = await watchTypegen(baseOpts)
          if (!opts.silent) {
            console.log('  kick typegen: watching for changes (Ctrl-C to exit)')
          }
          const shutdown = () => {
            stop()
            process.exit(0)
          }
          process.on('SIGINT', shutdown)
          process.on('SIGTERM', shutdown)
          // Keep the event loop alive until shutdown
          await new Promise<void>(() => {})
        } else {
          await runTypegen(baseOpts)

          // Plugin-typegen pipeline runs after the legacy pass. Builtins
          // ship the kick/db typegen; user plugins from kick.config.ts
          // contribute their own. T8 will fold the legacy emitters into
          // plugins and unify both paths into one runner call.
          const allPlugins = [...builtinCliPlugins, ...(config?.plugins ?? [])]
          const merged = mergeCliPlugins(allPlugins, config?.commands ?? [])
          if (merged.typegens.length > 0) {
            const results = await runPluginTypegens({
              cwd,
              config: config ?? ({} as never),
              plugins: merged.typegens,
              check: opts.check,
            })
            if (!opts.silent) {
              for (const r of results) console.log(`  ${r.id}: ${r.status}`)
            }
            if (opts.check && results.some((r) => r.status === 'written')) {
              process.exit(1)
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof TokenCollisionError) {
          console.error('\n' + err.message + '\n')
        } else if (err instanceof Error) {
          console.error(`\n  kick typegen failed: ${err.message}`)
        } else {
          console.error(`\n  kick typegen failed: ${JSON.stringify(err)}`)
        }
        process.exit(1)
      }
    })
}
