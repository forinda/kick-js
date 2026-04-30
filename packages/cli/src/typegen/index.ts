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
import { validateTokenConventions, type TokenConventionWarning } from './token-conventions'
import { discoverAssets } from './asset-types'
import type { AssetMapEntry } from '../config'

export type {
  DiscoveredClass,
  DiscoveredToken,
  DiscoveredInject,
  DiscoveredEnv,
  DiscoveredPluginOrAdapter,
  DiscoveredAugmentation,
  ClassCollision,
  ScanResult,
} from './scanner'
export type { GenerateResult } from './generator'
export { TokenCollisionError } from './generator'
export { validateTokenConventions, type TokenConventionWarning } from './token-conventions'

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
  /**
   * Path to the env schema file (relative to `cwd`). The file must
   * default-export a `defineEnv(...)` schema for the typed `KickEnv`
   * augmentation to be emitted. Defaults to `'src/env.ts'`. Set to
   * `false` to disable env typing entirely.
   */
  envFile?: string | false
  /**
   * Asset map from `kick.config.ts`. When set, `runTypegen` walks
   * each entry's `src` directory + emits `.kickjs/types/assets.d.ts`
   * augmenting `KickAssets` for autocomplete on `assets.x.y()` and
   * `@Asset('x/y')`. Omit to skip the asset typegen pass entirely.
   */
  assetMap?: Record<string, AssetMapEntry>
  /**
   * Whether `runTypegen` should also run the TypegenPlugin pipeline
   * (`runAllPluginTypegens`) after the legacy generator pass. Defaults
   * to `true` so single-shot callers (kick g, commands/typegen, tests)
   * keep getting a fully-refreshed `.kickjs/types/` from one entry
   * point. `watchTypegen` flips this to `false` because it manages
   * the plugin pass itself + would otherwise double-run it on every
   * filesystem trigger.
   */
  runPlugins?: boolean
}

/** Resolve options to absolute paths */
function resolveOptions(opts: RunTypegenOptions): {
  cwd: string
  srcDir: string
  outDir: string
  silent: boolean
  allowDuplicates: boolean
  schemaValidator: 'zod' | false
  envFile: string | false
} {
  const cwd = opts.cwd ?? process.cwd()
  return {
    cwd,
    srcDir: resolve(cwd, opts.srcDir ?? 'src'),
    outDir: resolve(cwd, opts.outDir ?? '.kickjs/types'),
    silent: opts.silent ?? false,
    allowDuplicates: opts.allowDuplicates ?? false,
    schemaValidator: opts.schemaValidator ?? false,
    envFile: opts.envFile ?? 'src/env.ts',
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
  /** Token convention warnings — empty when every literal matches §22.2. */
  tokenWarnings: TokenConventionWarning[]
}> {
  const { cwd, srcDir, outDir, silent, allowDuplicates, schemaValidator, envFile } =
    resolveOptions(opts)

  const start = Date.now()
  const scan = await scanProject({
    root: srcDir,
    cwd,
    // Pass through unless explicitly disabled
    envFile: envFile === false ? undefined : envFile,
  })
  const assets = discoverAssets(opts.assetMap, cwd)
  const result = await generateTypes({
    classes: scan.classes,
    routes: scan.routes,
    tokens: scan.tokens,
    injects: scan.injects,
    collisions: scan.collisions,
    env: envFile === false ? null : scan.env,
    pluginsAndAdapters: scan.pluginsAndAdapters,
    augmentations: scan.augmentations,
    assets,
    outDir,
    allowDuplicates,
    schemaValidator,
  })
  // M2.B-T8 carve: routes + env live in plugin typegens, not the
  // legacy generator above. Run the plugin pipeline as part of
  // `runTypegen` by default so single-shot callers (kick g <leaf> /
  // commands/typegen / tests) stay on one entry point and see a
  // fully-refreshed `.kickjs/types/` after the call returns. Watch
  // mode opts out (`runPlugins: false`) because it drives the plugin
  // pass externally and would otherwise double-run it on every
  // filesystem trigger.
  if (opts.runPlugins !== false) {
    try {
      const { runAllPluginTypegens } = await import('./run-plugins')
      const { loadKickConfig } = await import('../config')
      const pluginConfig = await loadKickConfig(cwd)
      await runAllPluginTypegens({ cwd, config: pluginConfig, silent: true })
    } catch {
      // Plugin pipeline broken? The legacy pass already wrote the rest;
      // surfacing the error here would block dev tooling, which is
      // worse than skipping the affected augmentation file.
    }
  }

  const tokenWarnings = validateTokenConventions(scan.tokens)
  const elapsed = Date.now() - start

  if (!silent) {
    const where = outDir.replace(cwd + '/', '')
    const collisionNote =
      result.resolvedCollisions > 0 ? `, ${result.resolvedCollisions} collisions namespaced` : ''
    const envNote = result.envWritten ? ', env typed' : ''
    const pluginNote = result.pluginEntries > 0 ? `, ${result.pluginEntries} plugins/adapters` : ''
    const augNote =
      result.augmentationEntries > 0 ? `, ${result.augmentationEntries} augmentations` : ''
    const assetNote = result.assetEntries > 0 ? `, ${result.assetEntries} assets` : ''
    console.log(
      `  kick typegen → ${result.serviceTokens} services, ${result.routeEntries} routes, ${result.moduleTokens} modules${pluginNote}${augNote}${assetNote}${envNote}${collisionNote} → ${where} (${elapsed}ms)`,
    )
    if (tokenWarnings.length > 0) {
      console.warn(
        `  kick typegen: ${tokenWarnings.length} token(s) don't match the §22.2 convention:`,
      )
      for (const warning of tokenWarnings) {
        const variableNote = warning.variable ? ` [${warning.variable}]` : ''
        console.warn(
          `    '${warning.token}' (${warning.filePath})${variableNote} — ${warning.reason}`,
        )
        if (warning.suggestion) {
          console.warn(`      → suggestion: ${warning.suggestion}`)
        }
      }
    }
  }

  return { scan, result, tokenWarnings }
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
  const { srcDir, silent, cwd } = resolved
  // Watch mode always tolerates collisions — otherwise an in-progress
  // rename would crash the dev loop. The error is still printed.
  // `runPlugins: false` keeps `runTypegen` from double-running the
  // plugin pipeline; the watcher already calls `runPlugins()`
  // explicitly after each `safeRun`.
  const runOpts: RunTypegenOptions = { ...resolved, allowDuplicates: true, runPlugins: false }

  // Polling is the right strategy for Docker bind mounts, WSL crosses,
  // NFS, and some kernel/filesystem combos where `fs.watch` returns
  // without errors but events silently drop. Adopters opt in via
  // `KICKJS_WATCH_POLLING=1`; default stays event-based (lower CPU).
  const forcePolling =
    process.env.KICKJS_WATCH_POLLING === '1' || process.env.KICKJS_WATCH_POLLING === 'true'

  // Lazy-import the plugin pipeline + config loader to avoid an eager
  // module-eval cycle (this file is reachable from plugin/builtins via
  // commands/typegen → ../typegen).
  const [{ runAllPluginTypegens }, { loadKickConfig }] = await Promise.all([
    import('./run-plugins'),
    import('../config'),
  ])
  const pluginConfig = await loadKickConfig(cwd)
  const runPlugins = () =>
    runAllPluginTypegens({ cwd, config: pluginConfig, silent: true }).catch(() => {})

  // Initial run — legacy pass first, then plugin typegens.
  await safeRun(runOpts, silent)
  await runPlugins()

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
      void runPlugins()
    }, 100)
  }

  // Forced-polling path — skip fs.watch entirely and just re-scan
  // periodically. The 2s interval matches the existing fallback so
  // adopters who flip the env var don't see a dramatic CPU jump.
  if (forcePolling) {
    if (!silent) {
      console.log('  kick typegen: polling mode (KICKJS_WATCH_POLLING)')
    }
    const interval = setInterval(() => {
      safeRun({ ...runOpts, silent: true }, true)
    }, 2000)
    return () => clearInterval(interval)
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
