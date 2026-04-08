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

interface TypegenCliOptions {
  watch?: boolean
  src: string
  out: string
  silent?: boolean
  allowDuplicates?: boolean
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
    .action(async (opts: TypegenCliOptions) => {
      const baseOpts = {
        cwd: process.cwd(),
        srcDir: opts.src,
        outDir: opts.out,
        silent: opts.silent,
        allowDuplicates: opts.allowDuplicates,
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
