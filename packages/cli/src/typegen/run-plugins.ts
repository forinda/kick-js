// Helper that wires the plugin-typegen pipeline into `kick dev`,
// `kick typegen`, and `kick typegen --watch` without duplicating the
// merge + filter + invoke dance at every call site.
//
// Loads built-ins + adopter plugins, merges them, filters by
// `kick.config.ts > typegen.disable`, runs every typegen via the T7
// runner. In silent mode errors are swallowed so a transiently-broken
// plugin doesn't crash the dev loop. Returns the per-plugin status
// array — callers may log it, exit non-zero on drift (--check), etc.

import type { KickConfig } from '../config'
import { mergeCliPlugins } from '../plugin'
import { builtinCliPlugins } from '../plugin/builtins'
import { runTypegen as runPluginTypegens } from './runner'
import type { ScanDelta } from './scanner'
import type { TypegenPluginResult } from './plugin'
import { applyDisableFilter } from './disable-filter'

// Re-export so the existing public surface (cli/index.ts) still resolves.
export { applyDisableFilter } from './disable-filter'

export interface RunAllPluginTypegensOptions {
  cwd: string
  /** Pre-loaded kick.config.ts (saves a re-read). */
  config: KickConfig | null
  /** Suppress per-plugin status logging. Errors still swallowed when true. */
  silent?: boolean
  /** CI gate — fail (do not write) on the first plugin whose output drifted. */
  check?: boolean
  /**
   * Exact watcher delta. Forwarded to the scanner so the plugin pass
   * scans incrementally (changed files only) instead of re-walking the
   * whole tree. Used by `kick dev`'s file-change handler.
   */
  changedFiles?: ScanDelta
}

export async function runAllPluginTypegens(
  opts: RunAllPluginTypegensOptions,
): Promise<TypegenPluginResult[]> {
  const allPlugins = [...builtinCliPlugins, ...(opts.config?.plugins ?? [])]
  const merged = mergeCliPlugins(allPlugins, opts.config?.commands ?? [])

  const { enabled, skipped, unknown } = applyDisableFilter(
    merged.typegens,
    opts.config?.typegen?.disable ?? [],
  )

  if (!opts.silent && skipped.length > 0) {
    for (const tg of skipped) {
      console.log(`  ${tg.id}: disabled (typegen.disable)`)
    }
  }

  // Unrecognised disable ids are non-fatal — surface as a warning so
  // typos surface early without breaking the dev loop. `kick typegen
  // --list` prints the canonical id list.
  if (!opts.silent && unknown.length > 0) {
    console.warn(
      `  kick typegen: disable list references unknown id(s): ${unknown
        .map((id) => `'${id}'`)
        .join(', ')}. Run \`kick typegen --list\` to see registered ids.`,
    )
  }

  if (enabled.length === 0) return []

  try {
    const results = await runPluginTypegens({
      cwd: opts.cwd,
      config: opts.config ?? ({} as never),
      plugins: enabled,
      check: opts.check,
      changedFiles: opts.changedFiles,
    })
    if (!opts.silent) {
      for (const r of results) console.log(`  ${r.id}: ${r.status}`)
    }
    return results
  } catch (err) {
    if (!opts.silent) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`  kick typegen plugins: skipped (${msg})`)
    }
    return []
  }
}
