// TypegenPlugin contract — M2.B-T7.
//
// Each plugin owns a single `.kickjs/types/<id>.d.ts` file. The runner
// invokes `generate(ctx)` per plugin, prepends a banner, writes only on
// content change, and surfaces drift in --check mode (CI gate).
//
// Built-in plugins (kick/routes, kick/env, kick/assets, kick/db) live under
// `./builtin`. Adopters register additional plugins via kick.config.ts.

import type { KickConfig } from '../config'
import type { ScanOptions, ScanResult } from './scanner'

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
  /**
   * Run `scanProject` once per typegen pass, memoizing the result so
   * multiple plugins (`kick/routes`, `kick/env`, future adopter plugins)
   * share a single fs walk + AST extraction.
   *
   * The runner uses an order-independent cache key derived from the
   * resolved options (`root`, `cwd`, `extensions`, `exclude`, `envFile`)
   * — semantically equal options hit the cache regardless of how the
   * caller built the literal. (We deliberately don't `JSON.stringify`
   * the options for caching since that would be sensitive to property
   * insertion order.) Plugins that don't need scanner data can ignore
   * this method entirely.
   *
   * Implementation lives in the runner so test harnesses can inject
   * a stub scanner; plugins only see the function.
   */
  getScanResult(opts: ScanOptions): Promise<ScanResult>
  log: TypegenLogger
}

export interface TypegenPlugin {
  /** Stable id — used as filename: `.kickjs/types/${id}<outExtension>` (slashes → `__`). */
  id: string
  /** Glob patterns the Vite watcher subscribes to; change → re-run this plugin. */
  inputs: string[]
  /**
   * Output filename extension. Default `.d.ts` — the right choice for
   * pure module-augmentation plugins (kick/db, kick/assets) since
   * declaration files don't need the runtime-import dance.
   *
   * `kick/routes` overrides to `.ts` because it emits hoisted
   * `import type {...} from '...'` lines at the top of the file. Inline
   * `import('...').X` references inside `.d.ts` silently degrade to
   * `unknown` under `moduleResolution: 'bundler'`; emitting `.ts`
   * sidesteps that quirk and gets full type resolution.
   *
   * Adopter-supplied plugins should leave this unset unless they hit
   * the same hoisted-import constraint.
   */
  outExtension?: string
  /**
   * Return the augmentation source (without banner — runner prepends).
   * Return null to skip emission (e.g. no schema file present).
   */
  generate(ctx: TypegenContext): Promise<string | null>
}

export interface TypegenPluginResult {
  id: string
  status: 'written' | 'unchanged' | 'skipped' | 'error'
  outFile?: string
}

/**
 * Identity factory for {@link TypegenPlugin}. Returns the spec verbatim.
 * Exists for type inference and forward-compatibility — future
 * fields can be added with defaults without breaking adopters.
 *
 * Mirrors {@link defineGenerator} ergonomics. Use at the call site so
 * the plugin's `generate(ctx)` body gets a fully-typed `ctx` without
 * an explicit annotation:
 *
 * @example
 * ```ts
 * import { defineTypegen } from '@forinda/kickjs-cli'
 *
 * export const drizzleTypegen = defineTypegen({
 *   id: 'drizzle',
 *   inputs: ['src/db/schema.ts'],
 *   async generate(ctx) {
 *     const schema = await ctx.importTs(`${ctx.cwd}/src/db/schema.ts`)
 *     return `// declare module …`
 *   },
 * })
 * ```
 */
export function defineTypegen(spec: TypegenPlugin): TypegenPlugin {
  return spec
}
