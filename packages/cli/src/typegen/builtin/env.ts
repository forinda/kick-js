// kick/env typegen plugin — M2.B-T8 carve.
//
// Replaces the legacy `env.ts` emission in `generator.ts`. Reads the
// shared scan result via `ctx.getScanResult` (memoized, shared with
// `kick/routes` and any future scan-consuming plugin), then renders
// the `KickEnv` augmentation via `../render/env`.
//
// Output filename: `.kickjs/types/kick__env.ts` (`.ts`, not `.d.ts`,
// for the hoisted-import reason renderEnv documents). The plugin
// returns null when no env schema is discovered so the runner skips
// writing — matches the legacy "no env file → no augmentation" path.

import path from 'node:path'

import { renderEnv } from '../render/env'
import type { TypegenPlugin } from '../plugin'

export const kickEnvTypegen = (): TypegenPlugin => ({
  id: 'kick/env',
  outExtension: '.ts',
  // Re-run when the env schema file (or anywhere it could move to)
  // changes. The Vite watcher in kick dev catches src/**/*.ts already;
  // keeping the inputs broad ensures rename-the-env-file works without
  // a special case.
  inputs: ['src/env.ts', 'src/**/env.ts', 'src/**/*.env.ts'],
  async generate(ctx) {
    const envFile = resolveEnvFile(ctx)
    if (envFile === false) return null

    const scan = await ctx.getScanResult({
      root: resolveSrcDir(ctx),
      cwd: ctx.cwd,
      envFile,
    })
    if (!scan.env) return null

    const outFile = path.resolve(ctx.cwd, '.kickjs/types/kick__env.ts')
    return renderEnv(scan.env, outFile)
  },
})

function resolveSrcDir(ctx: { cwd: string; config: { typegen?: { srcDir?: string } } }): string {
  return path.resolve(ctx.cwd, ctx.config?.typegen?.srcDir ?? 'src')
}

function resolveEnvFile(ctx: {
  config: {
    typegen?: { envFile?: string | false }
  }
}): string | false | undefined {
  // Adopters can disable env typing entirely via
  // `typegen.envFile: false`. Returning `false` from this helper
  // lets the plugin short-circuit before scanning.
  return ctx.config?.typegen?.envFile
}
