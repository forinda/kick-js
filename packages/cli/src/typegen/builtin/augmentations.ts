// kick/augmentations typegen plugin.
//
// Emits the `defineAugmentation` catalogue (was `augmentations.d.ts`
// from the legacy generator) to `.kickjs/types/kick__augmentations.d.ts`.
// Documentation-only — one block per discovered `defineAugmentation`
// call so adopters can see every augmentable interface their plugins
// advertise.

import { renderAugmentations } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickAugmentationsTypegen = (): TypegenPlugin => ({
  id: 'kick/augmentations',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    return renderAugmentations(scan.augmentations)
  },
})
