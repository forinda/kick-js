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
import { scanProject, type ScanResult } from './scanner'
import { generateTypes, type GenerateResult, TokenCollisionError } from './generator'

export type {
  DiscoveredClass,
  DiscoveredToken,
  DiscoveredInject,
  ClassCollision,
  ScanResult,
} from './scanner'
export type { GenerateResult } from './generator'
export { TokenCollisionError } from './generator'

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
  /**
   * When `true`, duplicate class names are auto-namespaced by file path
   * instead of throwing. `kick dev` enables this so the dev server is
   * never blocked by an in-progress rename. CLI default is `false` so
   * `kick typegen` (and CI) catches collisions early. */
  allowDuplicates?: boolean
  /**
   * Schema validator used to derive `body`/`query`/`params` types from
   * route metadata. Currently only `'zod'` is supported; `false` (the
   * default) leaves these fields as `unknown`. Loaded from
   * `kick.config.ts` `typegen.schemaValidator` when invoked via the CLI.
   */
  schemaValidator?: 'zod' | false
}

/** Resolve options to absolute paths */
function resolveOptions(opts: RunTypegenOptions): {
  cwd: string
  srcDir: string
  outDir: string
  silent: boolean
  allowDuplicates: boolean
  schemaValidator: 'zod' | false
} {
  const cwd = opts.cwd ?? process.cwd()
  return {
    cwd,
    srcDir: resolve(cwd, opts.srcDir ?? 'src'),
    outDir: resolve(cwd, opts.outDir ?? '.kickjs/types'),
    silent: opts.silent ?? false,
    allowDuplicates: opts.allowDuplicates ?? false,
    schemaValidator: opts.schemaValidator ?? false,
  }
}

/**
 * Run a single typegen pass: scan source files, generate `.d.ts` files.
 *
 * Returns the discovered scan result alongside the generation result so
 * callers (`kick dev`, devtools) can log them or feed them to other tools.
 *
 * Throws `TokenCollisionError` if duplicate class names are found and
 * `allowDuplicates` is false.
 */
export async function runTypegen(opts: RunTypegenOptions = {}): Promise<{
  scan: ScanResult
  result: GenerateResult
}> {
  const { cwd, srcDir, outDir, silent, allowDuplicates, schemaValidator } = resolveOptions(opts)

  const start = Date.now()
  const scan = await scanProject({ root: srcDir, cwd })
  const result = await generateTypes({
    classes: scan.classes,
    routes: scan.routes,
    tokens: scan.tokens,
    injects: scan.injects,
    collisions: scan.collisions,
    outDir,
    allowDuplicates,
    schemaValidator,
  })
  const elapsed = Date.now() - start

  if (!silent) {
    const where = outDir.replace(cwd + '/', '')
    const collisionNote =
      result.resolvedCollisions > 0 ? `, ${result.resolvedCollisions} collisions namespaced` : ''
    console.log(
      `  kick typegen → ${result.serviceTokens} services, ${result.routeEntries} routes, ${result.moduleTokens} modules${collisionNote} → ${where} (${elapsed}ms)`,
    )
  }

  return { scan, result }
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
 * In watch mode collisions are reported but never thrown — the watcher
 * keeps running so the user can fix the rename and the next scan
 * recovers automatically.
 *
 * Returns a `stop()` function that closes the watcher.
 */
export async function watchTypegen(opts: RunTypegenOptions = {}): Promise<() => void> {
  const resolved = resolveOptions(opts)
  const { srcDir, silent } = resolved
  // Watch mode always tolerates collisions — otherwise an in-progress
  // rename would crash the dev loop. The error is still printed.
  const runOpts: RunTypegenOptions = { ...resolved, allowDuplicates: true }

  // Initial run
  await safeRun(runOpts, silent)

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
      safeRun(runOpts, silent)
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
      safeRun({ ...runOpts, silent: true }, true)
    }, 2000)
    return () => clearInterval(interval)
  }

  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

/** Run typegen swallowing errors so the watcher loop never dies */
async function safeRun(opts: RunTypegenOptions, silent: boolean): Promise<void> {
  try {
    await runTypegen(opts)
  } catch (err) {
    if (silent) return
    if (err instanceof TokenCollisionError) {
      console.error('\n' + err.message + '\n')
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  kick typegen failed: ${msg}`)
    }
  }
}
