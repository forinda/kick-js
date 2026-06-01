/**
 * Public entry point for the KickJS typegen module.
 *
 * Used by:
 * - `kick typegen` (one-shot or watch mode)
 * - `kick dev` (auto-runs once before Vite starts; refreshes when files change)
 *
 * @module @forinda/kickjs-cli/typegen
 */

import { resolve, basename } from 'node:path'
import { readdir, stat, unlink } from 'node:fs/promises'
import { scanProject, type ScanResult } from './scanner'
import { generateTypes, type GenerateResult, TokenCollisionError } from './generator'
import { validateTokenConventions, type TokenConventionWarning } from './token-conventions'
import { discoverAssets } from './asset-types'
import type { AssetMapEntry } from '../config'
import type { TypegenPluginResult } from './plugin'

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
  schemaValidator?: 'zod' | 'kickjs-schema' | false
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
  schemaValidator: 'zod' | 'kickjs-schema' | false
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
  // kick new / tests) stay on one entry point and see a fully-
  // refreshed `.kickjs/types/` after the call returns. Watch mode
  // and the `kick typegen` / `kick dev` / `kick build` CLI paths
  // opt out (`runPlugins: false`) because they drive the plugin
  // pass externally and would otherwise double-run it.
  let pluginResults: TypegenPluginResult[] = []
  if (opts.runPlugins !== false) {
    try {
      const { runAllPluginTypegens } = await import('./run-plugins')
      const { loadKickConfig } = await import('../config')
      const pluginConfig = await loadKickConfig(cwd)
      pluginResults = await runAllPluginTypegens({ cwd, config: pluginConfig, silent: true })
    } catch (err) {
      // Broken plugins shouldn't block dev tooling — generators have
      // already written the rest of `.kickjs/types/`, and surfacing
      // here as a throw would abort the wider command (kick g, kick
      // new). When `silent` is false, log the message so the failure
      // is at least visible; otherwise swallow.
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  kick typegen: plugin pipeline failed (${msg}) — continuing`)
      }
    }
  }

  // Sweep stale `.kickjs/types/*` files. Older CLI versions emitted
  // `env.ts`, `routes.ts`, and (until this fix) `assets.d.ts` directly
  // from the legacy generator. Once those carved out into `kick/env`,
  // `kick/routes`, and `kick/assets` typegen plugins, the legacy
  // file names became orphans — but were never deleted on subsequent
  // runs, so adopters who upgraded saw `KickAssets`/`KickEnv`/
  // `KickRoutes` declared twice (once legacy, once `kick__*`). Sweep
  // walks the output dir at the end of every pass and unlinks any
  // top-level file not in the expected set, so a single `kick typegen`
  // run after upgrade self-heals.
  if (opts.runPlugins !== false) {
    await sweepStaleTypegen(outDir, result.written, pluginResults, silent)
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
    if (scan.orphanedClasses.length > 0) {
      // forinda/kick-js#235 §4 — decorated classes sitting inside a
      // module directory whose globs don't pick them up. At runtime
      // the decorator never fires; downstream code paths get
      // confusing `MissingContributorError` or silent misroutes.
      console.warn(
        `  kick typegen: ${scan.orphanedClasses.length} decorated class(es) not matched by any module's import.meta.glob():`,
      )
      for (const orphan of scan.orphanedClasses) {
        console.warn(`    @${orphan.decorator} ${orphan.className} (${orphan.relativePath})`)
        console.warn(`      → not picked up by any glob in ${orphan.moduleFilePath}`)
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
  // plugin pipeline; the watcher invokes `runPlugins()` explicitly
  // after each `runLegacy()` so both phases land before the sweep.
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
  // Track the most recent generator + plugin outputs so the post-run
  // sweep knows the full expected set. The legacy generator returns
  // its written list on each call (captured below via a closure), and
  // the plugin pipeline returns one per plugin.
  let lastGeneratorWritten: readonly string[] = []
  const runLegacy = async () => {
    try {
      const out = await runTypegen({ ...runOpts })
      lastGeneratorWritten = out.result.written
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
  const runPlugins = async () => {
    try {
      const pluginResults = await runAllPluginTypegens({
        cwd,
        config: pluginConfig,
        silent: true,
      })
      await sweepStaleTypegen(resolved.outDir, lastGeneratorWritten, pluginResults, true)
    } catch {
      /* swallow — watcher must never die */
    }
  }

  // Initial run — legacy pass first, then plugin typegens.
  await runLegacy()
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
      void runLegacy().then(runPlugins)
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

/**
 * Remove orphaned typegen output. The legacy generator emitted
 * `assets.d.ts`, `env.ts`, and `routes.ts` directly; once those carved
 * into the `kick/assets`, `kick/env`, and `kick/routes` plugins, the
 * legacy file names became stale on disk for any project that had run
 * an older CLI. Without a sweep, both copies coexist and adopters get
 * duplicated `KickAssets` / `KickEnv` / `KickRoutes` augmentations.
 *
 * Strategy: enumerate the top level of `outDir`, keep the union of
 * generator-written files + plugin-written files, unlink anything
 * else. Subdirectories are left alone — typegen never creates them.
 * Errors are swallowed (silent → no log) so a transient ENOENT or
 * permission glitch never aborts the wider command.
 */
export async function sweepStaleTypegen(
  outDir: string,
  generatorWritten: readonly string[],
  pluginResults: readonly TypegenPluginResult[],
  silent: boolean,
): Promise<string[]> {
  const expected = new Set<string>()
  for (const file of generatorWritten) expected.add(basename(file))
  for (const r of pluginResults) {
    if (r.outFile) expected.add(basename(r.outFile))
  }
  let entries: string[]
  try {
    entries = await readdir(outDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of entries) {
    // Allowlist, NOT denylist. The earlier "delete anything not in the
    // expected set" form was a footgun: if the plugin pass aborted
    // (e.g. one plugin threw and the runner bubbled it up, so
    // `pluginResults` came back empty), the expected set lost
    // `kick__routes.ts` / `kick__assets.d.ts` / `kick__env.ts` and the
    // sweep deleted those good files — wiping controller route types
    // project-wide. We now only remove the specific pre-carve filenames
    // the legacy generator used to emit, and only when the current pass
    // didn't (re)write them. Anything else is left untouched.
    if (!LEGACY_ORPHAN_FILES.has(name)) continue
    if (expected.has(name)) continue
    const abs = resolve(outDir, name)
    try {
      const s = await stat(abs)
      if (!s.isFile()) continue
      await unlink(abs)
      removed.push(name)
    } catch {
      // Best-effort; don't crash the typegen pass on a stat/unlink miss.
    }
  }
  if (removed.length > 0 && !silent) {
    console.log(`  kick typegen: swept ${removed.length} stale file(s): ${removed.join(', ')}`)
  }
  return removed
}

/**
 * Pre-carve filenames the legacy generator emitted directly before
 * `kick/routes`, `kick/env`, and `kick/assets` became typegen plugins
 * (which now write `kick__routes.ts` / `kick__env.ts` /
 * `kick__assets.d.ts`). A project that upgraded across the M2.B-T8
 * carve has these as orphans on disk; the sweep removes them so the
 * augmentations aren't declared twice. None of these names collide with
 * any file the current generator or plugins emit, so the sweep can
 * never touch live output.
 */
const LEGACY_ORPHAN_FILES: ReadonlySet<string> = new Set(['assets.d.ts', 'env.ts', 'routes.ts'])
