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
import { resolve } from 'node:path'
import { runTypegen, sweepStaleTypegen, TokenCollisionError, watchTypegen } from '../typegen'
import { runAllPluginTypegens } from '../typegen/run-plugins'
import { loadKickConfig } from '../config'
import { findProjectRoot } from '../utils/project-root'

interface TypegenCliOptions {
  watch?: boolean
  src: string
  out: string
  silent?: boolean
  allowDuplicates?: boolean
  schemaValidator?: string
  envFile?: string
  check?: boolean
  list?: boolean
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
    .option('--list', 'List every registered typegen plugin id (use to populate `typegen.disable`)')
    .action(async (opts: TypegenCliOptions) => {
      // Walk up from process.cwd() to the directory that owns kick.config.*
      // (or package.json). Without this, running `kick typegen` from inside
      // `src/` would resolve srcDir/outDir relative to `src/`, writing
      // `.kickjs/types/` to `src/.kickjs/types/` instead of the project root.
      const cwd = findProjectRoot(process.cwd())

      // CLI flag wins over kick.config.ts; the config sets the project default.
      const config = await loadKickConfig(cwd)

      // --list short-circuits: print the registered typegen ids + their
      // owning plugin and exit. Adopters use this to discover what to
      // put in `typegen.disable`.
      if (opts.list) {
        const { mergeCliPlugins } = await import('../plugin')
        const { builtinCliPlugins } = await import('../plugin/builtins')
        const allPlugins = [...builtinCliPlugins, ...(config?.plugins ?? [])]
        const merged = mergeCliPlugins(allPlugins, config?.commands ?? [])
        const disabled = new Set(config?.typegen?.disable ?? [])
        if (merged.typegens.length === 0) {
          console.log('  No typegen plugins registered.')
          return
        }
        const idWidth = Math.max(...merged.typegens.map((t) => t.id.length))
        console.log('\n  Registered typegen plugins:\n')
        for (const tg of merged.typegens) {
          const status = disabled.has(tg.id) ? ' (disabled)' : ''
          console.log(
            `    ${tg.id.padEnd(idWidth + 2)}inputs: ${tg.inputs.join(', ') || '(none)'}${status}`,
          )
        }
        console.log()
        return
      }
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
        // The CLI command drives the plugin pipeline directly (see
        // runAllPluginTypegens below) so it can surface --check drift
        // and per-plugin status. Opting out of `runTypegen`'s built-in
        // pass prevents a double run on every `kick typegen` invocation.
        runPlugins: false,
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
          const { result } = await runTypegen(baseOpts)

          // Plugin-typegen pipeline runs after the legacy pass. The
          // helper handles merging builtins with user plugins, applies
          // the `typegen.disable` filter, logs per-plugin status, and
          // surfaces drift for the --check exit code.
          const results = await runAllPluginTypegens({
            cwd,
            config: config ?? null,
            silent: opts.silent,
            check: opts.check,
          })
          if (opts.check && results.some((r) => r.status === 'written')) {
            process.exit(1)
          }

          // Sweep orphans from older CLI versions (e.g. legacy
          // `assets.d.ts`/`env.ts`/`routes.ts` left behind after the
          // M2.B-T8 carve). Skipped under --check so the gate stays
          // strictly diagnostic.
          if (!opts.check) {
            const outDir = resolve(cwd, opts.out ?? config?.typegen?.outDir ?? '.kickjs/types')
            await sweepStaleTypegen(outDir, result.written, results, opts.silent ?? false)
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
