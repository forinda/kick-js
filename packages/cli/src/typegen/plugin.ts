// TypegenPlugin contract — M2.B-T7.
//
// Each plugin owns a single `.kickjs/types/<id>.d.ts` file. The runner
// invokes `generate(ctx)` per plugin, prepends a banner, writes only on
// content change, and surfaces drift in --check mode (CI gate).
//
// Built-in plugins (kick/routes, kick/env, kick/assets, kick/db) live under
// `./builtin`. Adopters register additional plugins via kick.config.ts.

import type { KickConfig } from '../config'

export interface TypegenLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface TypegenContext {
  cwd: string
  config: KickConfig
  /** Dynamic-import a TS module (Node loader). Used by plugins that need to
   * read the adopter's schema / route map / asset registry at generate time. */
  importTs<T = unknown>(absPath: string): Promise<T>
  /** Write under `cwd`. Caller passes a relPath (e.g. `.kickjs/types/foo.d.ts`). */
  writeFile(relPath: string, contents: string): Promise<void>
  log: TypegenLogger
}

export interface TypegenPlugin {
  /** Stable id — used as filename: `.kickjs/types/${id}.d.ts` (slashes → `__`). */
  id: string
  /** Glob patterns the Vite watcher subscribes to; change → re-run this plugin. */
  inputs: string[]
  /**
   * Return the augmentation source (without banner — runner prepends).
   * Return null to skip emission (e.g. no schema file present).
   */
  generate(ctx: TypegenContext): Promise<string | null>
}

export interface TypegenPluginResult {
  id: string
  status: 'written' | 'unchanged' | 'skipped'
  outFile?: string
}
