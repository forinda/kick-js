// kick/route-flags typegen plugin.
//
// Emits the `KickRouteFlags` registry to `.kickjs/types/kick__route-flags.d.ts`
// from every `defineRouteFlag('name')` call in the project.
//
// This is the cheap end of typegen: a flag is a positional string literal with
// an optional explicit value type, so there is no dependency graph to resolve
// and no per-route narrowing to compute — unlike context keys, whose registry
// needs the contributor pipeline's ordering rules to say anything useful. One
// AST branch in, a flat map out.

import { renderRouteFlags } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickRouteFlagsTypegen = (): TypegenPlugin => ({
  id: 'kick/route-flags',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    return renderRouteFlags(scan.routeFlags)
  },
})
