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
import { runTypegen, watchTypegen } from '../typegen'

export function registerTypegenCommand(program: Command): void {
  program
    .command('typegen')
    .description('Generate type-safe DI registry and module types into .kickjs/types/')
    .option('-w, --watch', 'Watch source files and regenerate on change')
    .option('-s, --src <dir>', 'Source directory to scan', 'src')
    .option('-o, --out <dir>', 'Output directory', '.kickjs/types')
    .option('--silent', 'Suppress output')
    .action(async (opts: { watch?: boolean; src: string; out: string; silent?: boolean }) => {
      const cwd = process.cwd()
      const baseOpts = {
        cwd,
        srcDir: opts.src,
        outDir: opts.out,
        silent: opts.silent,
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
      } catch (err: any) {
        console.error('\n  kick typegen failed:', err?.message ?? err)
        process.exit(1)
      }
    })
}
