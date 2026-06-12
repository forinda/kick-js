/**
 * Debounced typegen-on-save watcher — the engine behind `kick dev`'s
 * file-change handling, extracted so `@forinda/kickjs-vite` can run the
 * SAME pipeline when the adopter boots plain `vite` (or any other
 * Vite-embedding tool) instead of `kick dev`.
 *
 * Behaviour (verbatim from the original inline implementation):
 *  - Watcher events batch into one debounced pass (default 100ms).
 *  - `.ts/.tsx/.mts/.cts` changes feed a precise `{changed, removed}`
 *    delta to the incremental scanner; `unlinkDir` forces a full walk
 *    (a dir removal can't be expressed as a per-file delta).
 *  - Files under an `assetMap.<ns>.src` dir mark the pass asset-dirty,
 *    driving an incremental `buildAssets` sweep.
 *  - `.kickjs/**` and `.d.ts` events are ignored (typegen's own output).
 *  - Failures surface through a deduplicating reporter (one warning per
 *    NEW failure message per source; quiet on repeats; re-arms after a
 *    successful pass).
 *
 * Exactly one watcher should own typegen per dev process. `kick dev`
 * claims ownership via {@link TYPEGEN_OWNER_KEY} on `globalThis` before
 * booting Vite; the vite plugin checks the marker and stands down.
 */
import path from 'node:path'

import type { KickConfig } from '../config'
import type { runTypegen, writeTypegenArtifacts } from './index'
import type { runAllPluginTypegens } from './run-plugins'
import type { buildAssets } from '../asset-manager/build'
import { createTypegenErrorReporter } from '../commands/typegen-error-reporter'
import type { ScanDelta } from './scanner'

/**
 * `globalThis` key claiming typegen ownership for the current process.
 * Set by `kick dev` (which boots Vite in-process) so the vite plugin's
 * own watcher never double-runs the pipeline.
 */
export const TYPEGEN_OWNER_KEY = '__kickjs_typegen_owner'

export type TypegenWatchEvent = 'add' | 'change' | 'unlink' | 'unlinkDir'

/** Injectable pipeline — production uses the real functions. */
export interface TypegenDevPipeline {
  runTypegen: typeof runTypegen
  runAllPluginTypegens: typeof runAllPluginTypegens
  writeTypegenArtifacts: typeof writeTypegenArtifacts
  buildAssets: typeof buildAssets
}

export interface TypegenDevWatcherOptions {
  cwd: string
  /** Pre-loaded kick.config.ts (null when the project has none). */
  config: KickConfig | null
  /**
   * Warning sink — wired by the caller to `console.warn` plus whatever
   * HMR broadcast it has (e.g. the `kickjs:typegen-error` custom event).
   */
  emitWarning: (message: string) => void
  /**
   * Invoked after each pass's plugin chain settles (success or failure).
   * `kick dev` uses it to schedule the `--typecheck` worker against
   * fresh `.kickjs/types`.
   */
  onPassComplete?: () => void
  /** Debounce window in ms. @default 100 */
  debounceMs?: number
  /** Test seam — defaults to the real typegen pipeline. */
  pipeline?: TypegenDevPipeline
}

export interface TypegenDevWatcher {
  /** Feed a chokidar-style watcher event into the debounce window. */
  handleWatchEvent(event: TypegenWatchEvent, file: string): void
  /**
   * Run one full (non-incremental) pass immediately — startup catch-up
   * for callers that didn't run typegen before the server booted.
   */
  runOnce(): void
  /**
   * Absolute `assetMap.<ns>.src` roots. Vite's default watcher ignores
   * extensions it doesn't compile, so callers should `watcher.add(...)`
   * these to receive template-file events at all.
   */
  assetSrcRoots: readonly string[]
  /** Cancel any pending debounced pass. */
  dispose(): void
}

export function createTypegenDevWatcher(opts: TypegenDevWatcherOptions): TypegenDevWatcher {
  const { cwd, config } = opts
  const debounceMs = opts.debounceMs ?? 100
  // Default pipeline resolves lazily — a static import would drag the
  // whole generator/typegen graph (including dist-layout-only module
  // initializers) into every consumer of this module.
  const pipeline: TypegenDevPipeline = opts.pipeline ?? {
    runTypegen: async (o) => (await import('./index')).runTypegen(o),
    runAllPluginTypegens: async (o) => (await import('./run-plugins')).runAllPluginTypegens(o),
    writeTypegenArtifacts: async (dir, results, silent) =>
      (await import('./index')).writeTypegenArtifacts(dir, results, silent),
    buildAssets: async (cfg, o) => (await import('../asset-manager/build')).buildAssets(cfg, o),
  }

  const schemaValidator = config?.typegen?.schemaValidator ?? 'zod'
  const envFile = config?.typegen?.envFile
  const typesOutDir = path.resolve(cwd, config?.typegen?.outDir ?? '.kickjs/types')

  const assetSrcRoots: readonly string[] = config?.assetMap
    ? Object.values(config.assetMap)
        .map((entry) => entry?.src)
        .filter((src): src is string => typeof src === 'string' && src.length > 0)
        .map((src) => path.resolve(cwd, src))
    : []
  const hasAssetMap = !!config?.assetMap && Object.keys(config.assetMap).length > 0
  const isAssetFile = (file: string): boolean =>
    assetSrcRoots.some((root) => file === root || file.startsWith(`${root}/`))

  const reporter = createTypegenErrorReporter(opts.emitWarning)

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const pendingChanged = new Set<string>()
  const pendingRemoved = new Set<string>()
  let forceFullScan = false
  let assetDirty = false

  function firePass(delta: ScanDelta | undefined, rebuildAssets: boolean): void {
    pipeline
      .runTypegen({
        cwd,
        silent: true,
        allowDuplicates: true,
        schemaValidator,
        envFile,
        srcDir: config?.typegen?.srcDir,
        outDir: config?.typegen?.outDir,
        assetMap: config?.assetMap,
        changedFiles: delta,
        // Plugin pipeline runs separately just below; opting out here
        // avoids double-running it on every debounced trigger.
        runPlugins: false,
      })
      .then(() => reporter.clear('scan'))
      .catch((err) => reporter.report('scan', err))
    pipeline
      .runAllPluginTypegens({ cwd, config, silent: true, changedFiles: delta })
      .then((r) => pipeline.writeTypegenArtifacts(typesOutDir, r, true))
      .then(() => reporter.clear('plugins'))
      .catch((err) => reporter.report('plugins', err))
      // Post-pass hook AFTER the plugin chain settles so consumers (the
      // --typecheck worker) see the freshest .kickjs/types this window
      // produced.
      .finally(() => opts.onPassComplete?.())
    if (rebuildAssets && config) {
      pipeline.buildAssets(config, { cwd, silent: true }).catch(() => {})
    }
  }

  function flush(): void {
    // `undefined` delta → full scan (the `unlinkDir` correctness path).
    const delta = forceFullScan
      ? undefined
      : { changed: [...pendingChanged], removed: [...pendingRemoved] }
    const rebuildAssets = assetDirty
    pendingChanged.clear()
    pendingRemoved.clear()
    forceFullScan = false
    assetDirty = false
    firePass(delta, rebuildAssets)
  }

  return {
    assetSrcRoots,

    handleWatchEvent(event, file) {
      if (disposed) return
      if (file.includes('.kickjs')) return
      if (event === 'unlinkDir') {
        // Only meaningful if the removed dir could have held scanned
        // sources or watched assets; cheap to just force a full scan.
        forceFullScan = true
        if (hasAssetMap) assetDirty = true
      } else {
        if (file.endsWith('.d.ts')) return
        const isTs = /\.(ts|tsx|mts|cts)$/.test(file)
        const isAsset = isAssetFile(file)
        if (!isTs && !isAsset) return
        if (isAsset && hasAssetMap) assetDirty = true
        // Only `.ts` files participate in the source scan delta. Asset-
        // only changes still trigger the pass (so the asset plugin
        // re-emits) but contribute nothing to the scan — an empty `.ts`
        // delta makes the incremental scan a near-instant cache replay.
        if (isTs) {
          if (event === 'unlink') {
            pendingRemoved.add(file)
            pendingChanged.delete(file)
          } else {
            pendingChanged.add(file)
            pendingRemoved.delete(file)
          }
        }
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    },

    runOnce() {
      if (disposed) return
      firePass(undefined, hasAssetMap)
    },

    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
