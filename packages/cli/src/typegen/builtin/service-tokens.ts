// kick/services typegen plugin.
//
// Emits the `ServiceToken` string-literal union (was `services.d.ts`
// from the legacy generator) to `.kickjs/types/kick__services.d.ts`.
// Union members: registry-decorated class names (namespaced on
// collision) + `createToken('name')` + `@Inject('literal')` literals.

import { buildServiceTokens, renderUnion } from '../render/manifest'
import { sharedScanOptions } from './scan-opts'
import type { TypegenPlugin } from '../plugin'

export const kickServiceTokensTypegen = (): TypegenPlugin => ({
  id: 'kick/services',
  inputs: ['src/**/*.ts'],
  async generate(ctx) {
    const scan = await ctx.getScanResult(sharedScanOptions(ctx))
    const colliding = new Set(scan.collisions.map((c) => c.className))
    const names = buildServiceTokens(scan.classes, scan.tokens, scan.injects, colliding)
    return renderUnion(
      'ServiceToken',
      names,
      '(no tokens discovered — declare with createToken<T>() or `kick g service <name>`)',
    )
  },
})
