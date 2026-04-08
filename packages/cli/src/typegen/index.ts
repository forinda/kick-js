/**
 * Public entry point for the KickJS typegen module.
 *
 * Used by:
 * - `kick typegen` (one-shot or watch mode)
 * - `kick dev` (auto-runs once before Vite starts; refreshes when files change)
 *
 * @module @forinda/kickjs-cli/typegen
 */

import { resolve } from 'node:path'
import { scanProject, type DiscoveredClass } from './scanner'
import { generateTypes, type GenerateResult } from './generator'

export type { DiscoveredClass } from './scanner'
export type { GenerateResult } from './generator'

/** Options for `runTypegen` */
export interface RunTypegenOptions {
  /** Project root (defaults to `process.cwd()`) */
  cwd?: string
  /** Source directory to scan (defaults to `src`) */
  srcDir?: string
  /** Output directory (defaults to `.kickjs/types`) */
  outDir?: string
  /** Suppress console output */
  silent?: boolean
}

/** Resolve options to absolute paths */
function resolveOptions(opts: RunTypegenOptions): {
  cwd: string
  srcDir: string
  outDir: string
  silent: boolean
} {
  const cwd = opts.cwd ?? process.cwd()
  return {
    cwd,
    srcDir: resolve(cwd, opts.srcDir ?? 'src'),
    outDir: resolve(cwd, opts.outDir ?? '.kickjs/types'),
    silent: opts.silent ?? false,
  }
}

/**
 * Run a single typegen pass: scan source files, generate `.d.ts` files.
 *
 * Returns the discovered classes alongside the generation result so
 * callers (`kick dev`) can log them or feed them to other tools.
 */
export async function runTypegen(opts: RunTypegenOptions = {}): Promise<{
  classes: DiscoveredClass[]
  result: GenerateResult
}> {
  const { cwd, srcDir, outDir, silent } = resolveOptions(opts)

  const start = Date.now()
  const classes = await scanProject({ root: srcDir, cwd })
  const result = await generateTypes({ classes, outDir })
  const elapsed = Date.now() - start

  if (!silent) {
    const where = outDir.replace(cwd + '/', '')
    console.log(
      `  kick typegen → ${result.registryEntries} services, ${result.moduleTokens} modules → ${where} (${elapsed}ms)`,
    )
  }

  return { classes, result }
}

/**
 * Watch mode for `kick typegen --watch`.
 *
 * Uses Node's built-in `fs.watch` (recursive, available on Linux 22+ and
 * macOS 19+). Falls back gracefully if recursive watch is not supported.
 *
 * Debounces re-runs by 100ms so a bulk file change (e.g. `kick g module`
 * creating 5 files at once) emits one regen, not five.
 *
 * Returns a `stop()` function that closes the watcher.
 */
export async function watchTypegen(opts: RunTypegenOptions = {}): Promise<() => void> {
  const { cwd, srcDir, outDir, silent } = resolveOptions(opts)

  // Initial run
  await runTypegen({ cwd, srcDir, outDir, silent })

  const { watch } = await import('node:fs')

  let timer: ReturnType<typeof setTimeout> | null = null
  const trigger = (filename: string | null) => {
    // Only react to TypeScript source changes; ignore everything else
    if (!filename) return
    if (!/\.(ts|tsx|mts|cts)$/.test(filename)) return
    if (filename.includes('.kickjs')) return
    if (filename.endsWith('.d.ts')) return

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      runTypegen({ cwd, srcDir, outDir, silent }).catch((err) => {
        if (!silent) console.error('  kick typegen failed:', err?.message ?? err)
      })
    }, 100)
  }

  let watcher: ReturnType<typeof watch>
  try {
    watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
      trigger(filename)
    })
  } catch (err: any) {
    if (!silent) {
      console.warn(
        `  kick typegen: watch mode unavailable (${err?.message ?? err}). Falling back to polling.`,
      )
    }
    // Polling fallback — re-scan every 2s
    const interval = setInterval(() => {
      runTypegen({ cwd, srcDir, outDir, silent: true }).catch(() => {})
    }, 2000)
    return () => clearInterval(interval)
  }

  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
