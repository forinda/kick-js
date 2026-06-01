// kick/context typegen plugin.
//
// Auto-populates the `ContextKeys` registry by scanning every
// `defineContextDecorator` / `defineHttpContextDecorator` `key:` literal
// in the project, emitting `.kickjs/types/kick__context.d.ts`. This
// makes `dependsOn` typo-checking automatic and complete — adopters
// never hand-maintain `ContextKeys`, and augmenting `ContextMeta` for a
// value type can never break a `dependsOn` (every real contributor key
// is already a known key).
//
// Returns null when no context decorators are discovered, so the runner
// skips emission for projects that don't use the contributor pipeline.

import { renderContextKeys } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickContextTypegen = (): TypegenPlugin => ({
  id: 'kick/context',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    if (scan.contextKeys.length === 0) return null
    return renderContextKeys(scan.contextKeys)
  },
})
