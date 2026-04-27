// Helper that wires the plugin-typegen pipeline into both `kick dev`
// and `kick typegen --watch` without duplicating the merge + invoke
// dance at every call site.
//
// Loads the built-in CLI plugins + adopter plugins from kick.config.ts,
// merges them, runs every typegen via the T7 runner, and (in silent
// mode) swallows errors so a transiently-broken plugin doesn't crash
// the dev loop. Returns the per-plugin status array — callers may log
// it or feed it to telemetry.

import type { KickConfig } from '../config'
import { mergeCliPlugins } from '../plugin'
import { builtinCliPlugins } from '../plugin/builtins'
import { runTypegen as runPluginTypegens } from './runner'
import type { TypegenPluginResult } from './plugin'

export interface RunAllPluginTypegensOptions {
  cwd: string
  /** Pre-loaded kick.config.ts (saves a re-read). */
  config: KickConfig | null
  /** Suppress per-plugin status logging. Errors still swallowed when true. */
  silent?: boolean
}

export async function runAllPluginTypegens(
  opts: RunAllPluginTypegensOptions,
): Promise<TypegenPluginResult[]> {
  const allPlugins = [...builtinCliPlugins, ...(opts.config?.plugins ?? [])]
  const merged = mergeCliPlugins(allPlugins, opts.config?.commands ?? [])
  if (merged.typegens.length === 0) return []

  try {
    const results = await runPluginTypegens({
      cwd: opts.cwd,
      config: opts.config ?? ({} as never),
      plugins: merged.typegens,
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
