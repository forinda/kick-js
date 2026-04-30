// kick/routes typegen plugin — M2.B-T8 carve.
//
// Replaces the legacy `routes.ts` emission in `generator.ts`. Reads the
// shared scan result via `ctx.getScanResult` (memoized, so kick/env
// and any future scan-consuming plugin share the walk), then renders
// the `KickRoutes` augmentation via `../render/routes`.
//
// Output filename: `.kickjs/types/kick__routes.ts` — the plugin sets
// `outExtension: '.ts'` so the runner writes a `.ts` (not `.d.ts`)
// file. The runner also translates the slash in the plugin id
// (`kick/routes`) to a double underscore on disk.

import path from 'node:path'

import { renderRoutes } from '../render/routes'
import type { TypegenPlugin } from '../plugin'

export const kickRoutesTypegen = (): TypegenPlugin => ({
  id: 'kick/routes',
  // Emit `.ts` (not `.d.ts`) so the hoisted `import type {...} from
  // '../../src/...'` lines inside renderRoutes resolve under
  // `moduleResolution: 'bundler'`. `.d.ts` would silently degrade
  // those references to `unknown`.
  outExtension: '.ts',
  // Re-run when any controller / route source changes. The Vite
  // watcher subscribes to these globs in `kick dev` to debounce a
  // single typegen pass per file change.
  inputs: ['src/**/*.controller.ts', 'src/**/*.module.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult({
      root: resolveSrcDir(ctx),
      cwd: ctx.cwd,
      // envFile passed through so the shared cache key matches kick/env's
      // expected scan when both plugins run in the same pass.
      envFile: resolveEnvFile(ctx),
    })

    const schemaValidator = ctx.config?.typegen?.schemaValidator ?? 'zod'
    // Plugin runner writes to .kickjs/types/kick__routes.ts. The
    // hoisted-import path computation inside renderRoutes needs the
    // absolute target so it can re-relativise schema imports.
    const outFile = path.resolve(ctx.cwd, '.kickjs/types/kick__routes.ts')
    return renderRoutes(scan.routes, outFile, schemaValidator)
  },
})

function resolveSrcDir(ctx: { cwd: string; config: { typegen?: { srcDir?: string } } }): string {
  return path.resolve(ctx.cwd, ctx.config?.typegen?.srcDir ?? 'src')
}

function resolveEnvFile(ctx: {
  cwd: string
  config: {
    typegen?: { envFile?: string | false }
  }
}): string | undefined {
  // Mirror legacy resolution semantics — `false` disables env discovery
  // (handled by kick/env plugin); undefined falls back to scanner default.
  const cfg = ctx.config?.typegen?.envFile
  if (cfg === false) return undefined
  return cfg
}
