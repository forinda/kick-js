// kick/plugins typegen plugin.
//
// Emits the `KickJsPluginRegistry` augmentation (was `plugins.d.ts` from
// the legacy generator) to `.kickjs/types/kick__plugins.d.ts`. Its
// `keyof` narrows `dependsOn` so misspelled plugin/adapter deps become
// compile errors instead of boot-time MissingMountDepError.

import { renderPlugins } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickPluginsRegistryTypegen = (): TypegenPlugin => ({
  id: 'kick/plugins',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    return renderPlugins(scan.pluginsAndAdapters)
  },
})
