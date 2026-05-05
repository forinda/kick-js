/**
 * Vite plugin wrapping `stripDevtoolsCode` for production builds.
 *
 * Runs only when Vite's `command === 'build'`. In dev the plugin is
 * a no-op so the devtools UI keeps working under `kick dev`.
 *
 * Pairs with `devtoolsFlagPlugin()` — that one constant-folds
 * `if (__KICKJS_DEVTOOLS__)` branches via Vite's existing DCE; this
 * one strips top-level devtools-kit imports + their `defineDevtoolsRenderTab(...)` /
 * `defineDevtoolsTab(...)` call sites without requiring adopters to
 * wrap them in the flag.
 *
 * Spec: docs/db/m3-plan.md §M3.C.
 */

import type { Plugin } from 'vite'
import { stripDevtoolsCode } from './babel-strip-devtools'

export interface DevtoolsStripOptions {
  /**
   * Force enable / disable. Default: enabled when `command === 'build'`.
   * Adopters running a debug-prod build (`kick build` with the flag
   * forced on) can pass `false` to keep devtools-kit code in the
   * bundle.
   */
  enabled?: boolean
  /**
   * Glob-like include pattern. Default: any `.ts` / `.tsx` /
   * `.mts` / `.cts` file under the project root. The transform is
   * a no-op on files that don't import devtools-kit, so this is
   * normally fine to leave at the default.
   */
  include?: RegExp
}

const DEFAULT_INCLUDE = /\.(?:m|c)?[jt]sx?$/

/**
 * Strips devtools-kit imports + their top-level call sites from
 * production bundles. See `babel-strip-devtools.ts` for the exact
 * rule set.
 */
export function devtoolsStripPlugin(opts: DevtoolsStripOptions = {}): Plugin {
  let active = false
  const include = opts.include ?? DEFAULT_INCLUDE

  return {
    name: 'kickjs:devtools-strip',
    enforce: 'pre',
    apply: 'build',
    config(_userConfig, env) {
      active = opts.enabled ?? env.command === 'build'
    },
    transform(code, id) {
      if (!active) return null
      if (id.includes('node_modules')) return null
      if (!include.test(id)) return null
      const result = stripDevtoolsCode(code, id)
      if (!result.changed) return null
      return { code: result.code, map: null }
    },
  }
}
