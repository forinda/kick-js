// kick/runtime typegen plugin.
//
// Emits the `KickRuntimeRegister` augmentation (spec §4.3b) that flips the
// runtime-typed escape hatches — `AdapterContext.app`, `getRuntimeApp()`, and
// (once the driver layer lands) `ctx.req.raw` / `ctx.res.raw` — to the configured
// engine's native types. Reads `runtime` from kick.config; the Express runtime is
// the framework default, so for `express` (or no runtime field) the plugin emits
// nothing (returns null) — `ActiveRuntime` already falls back to
// `ExpressRuntimeTypes` with no augmentation present.
//
// Output filename: `.kickjs/types/kick__runtime.ts`. `.ts` (not `.d.ts`) for the
// same reason kick/routes uses it — the inline `import('@forinda/kickjs/<rt>').X`
// reference would silently degrade to `unknown` inside a `.d.ts` under
// `moduleResolution: 'bundler'`. Mirrors the `kick/db` `KickDbRegister` and
// `kick/env` `KickEnv` augmentations, so the runtime type story is uniform.

import type { TypegenPlugin } from '../plugin'

/** The engine-native types export each non-default runtime subpath provides. */
const RUNTIME_TYPES: Record<'fastify' | 'h3', { subpath: string; typeName: string }> = {
  fastify: { subpath: '@forinda/kickjs/fastify', typeName: 'FastifyRuntimeTypes' },
  h3: { subpath: '@forinda/kickjs/h3', typeName: 'H3RuntimeTypes' },
}

export const kickRuntimeTypegen = (): TypegenPlugin => ({
  id: 'kick/runtime',
  outExtension: '.ts',
  // Re-run when kick.config changes (the `runtime` field is the only input).
  inputs: ['kick.config.ts', 'kick.config.js', 'kick.config.mjs'],
  async generate(ctx) {
    const runtime = (ctx.config as { runtime?: string } | undefined)?.runtime
    // Express (or unset) needs no augmentation — ActiveRuntime defaults to it.
    if (runtime !== 'fastify' && runtime !== 'h3') return null

    const { subpath, typeName } = RUNTIME_TYPES[runtime]
    return [
      `// Runtime escape-hatch types for the '${runtime}' engine (kick.config runtime).`,
      `declare module '@forinda/kickjs' {`,
      `  interface KickRuntimeRegister {`,
      `    runtime: import('${subpath}').${typeName}`,
      `  }`,
      `}`,
      ``,
      `export {}`,
      ``,
    ].join('\n')
  },
})
