// Shared scan-options resolver for the scan-consuming builtin typegen
// plugins (kick/routes, kick/registry, kick/services, kick/modules,
// kick/plugins, kick/augmentations).
//
// The runner memoizes `scanProject` per pass on an order-independent key
// derived from `{ root, cwd, envFile }`. Every plugin that wants the
// shared single walk MUST request it with the SAME resolved options, so
// the resolution lives here in one place rather than being re-derived
// (and accidentally diverging) per plugin.

import path from 'node:path'
import type { ScanOptions } from '../scanner'

interface ScanCtx {
  cwd: string
  config: { typegen?: { srcDir?: string; envFile?: string | false } }
}

/** Absolute source dir to scan (defaults to `<cwd>/src`). */
export function resolveSrcDir(ctx: ScanCtx): string {
  return path.resolve(ctx.cwd, ctx.config?.typegen?.srcDir ?? 'src')
}

/**
 * Env file passed into the scan. `typegen.envFile: false` disables env
 * discovery — mapped to `undefined` (matching kick/routes) so the cache
 * key is identical to the other scan-consuming plugins and they share
 * one walk.
 */
export function resolveScanEnvFile(ctx: ScanCtx): string | undefined {
  const cfg = ctx.config?.typegen?.envFile
  if (cfg === false) return undefined
  return cfg
}

/** Build the shared, memoization-friendly scan options for a plugin ctx. */
export function sharedScanOptions(ctx: ScanCtx): ScanOptions {
  return {
    root: resolveSrcDir(ctx),
    cwd: ctx.cwd,
    envFile: resolveScanEnvFile(ctx),
  }
}
