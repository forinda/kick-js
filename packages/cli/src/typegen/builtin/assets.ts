// kick/assets typegen plugin — M2.B-T8.
//
// Walks the project's `assetMap` and emits the same KickAssets
// augmentation the legacy generator produces, but routed through the
// TypegenPlugin contract. During the transition both this plugin and
// the legacy generator's `assets.d.ts` emission run; TS merges the
// two interface declarations safely (identical content). The legacy
// emission removes once routes/env land as plugins too.
//
// Resolution: returns null when there's no assetMap or it's empty.

import { existsSync } from 'node:fs'
import path from 'node:path'

import type { TypegenPlugin } from '../plugin'
import { discoverAssets, renderAssetTypes } from '../asset-types'
import { loadKickConfig } from '../../config'

export const kickAssetsTypegen = (): TypegenPlugin => ({
  id: 'kick/assets',
  // The watcher subscribes to kick.config.ts (so adding a new asset
  // namespace re-fires) plus a lightweight glob over each declared
  // src dir. The merge logic in run-plugins resolves this lazily.
  inputs: ['kick.config.ts', 'kick.config.js', 'kick.config.mjs'],
  async generate(ctx) {
    // The plugin runner doesn't load kick.config.ts itself — it leaves
    // each plugin in charge of its own inputs. Cheap to re-load here;
    // the cli wraps this plugin in run-plugins.ts which already has
    // the config but doesn't pass it through ctx (T8 follow-up).
    const cfgPath = path.resolve(ctx.cwd, 'kick.config.ts')
    if (!existsSync(cfgPath)) return null
    const config = await loadKickConfig(ctx.cwd)
    if (!config?.assetMap) return null
    const discovered = discoverAssets(config.assetMap, ctx.cwd)
    if (discovered.count === 0) return null
    return renderAssetTypes(discovered)
  },
})
