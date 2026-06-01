// kick/modules typegen plugin.
//
// Emits the `ModuleToken` string-literal union (was `modules.d.ts` from
// the legacy generator) to `.kickjs/types/kick__modules.d.ts`.

import { buildModuleTokens, renderUnion } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickModuleTokensTypegen = (): TypegenPlugin => ({
  id: 'kick/modules',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    return renderUnion(
      'ModuleToken',
      buildModuleTokens(scan.classes),
      '(no @Module classes discovered — `kick g module <name>` to add one)',
    )
  },
})
