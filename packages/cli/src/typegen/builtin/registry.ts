// kick/registry typegen plugin.
//
// Emits the `KickJsRegistry` module augmentation (was `registry.d.ts`
// from the legacy generator) to `.kickjs/types/kick__registry.d.ts`.
// Maps each discovered DI token to its class type so
// `container.resolve('UserService')` is typed.
//
// Colliding class names are auto-namespaced by file path. The hard
// "collision → fail" gate lives in `runTypegen` (before any plugin
// runs), so by the time this plugin executes either there are no
// collisions or `--allow-duplicates` was set; either way namespacing
// the colliding names here is correct.

import path from 'node:path'

import { renderRegistry } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickRegistryTypegen = (): TypegenPlugin => ({
  id: 'kick/registry',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    const outFile = path.resolve(ctx.cwd, '.kickjs/types/kick__registry.d.ts')
    const colliding = new Set(scan.collisions.map((c) => c.className))
    return renderRegistry(scan.classes, outFile, colliding)
  },
})
