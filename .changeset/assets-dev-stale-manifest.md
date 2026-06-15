---
'@forinda/kickjs': patch
---

assets: in dev, resolve from the live `src/` tree instead of a stale built manifest

`assets.x.y()` / `resolveAsset()` could return stale paths (or throw
`UnknownAssetError` for a freshly-added file) in development when an earlier
`kick build` had left a `dist/.kickjs-assets.json` on disk. The dev resolver
skips its in-memory cache so file additions show up live, but `discoverManifest`
still probed on-disk built manifests (`dist`/`build`/`out`) _before_ walking the
source tree — so the stale manifest shadowed `src/`.

Dev now prefers a fresh source walk and only falls back to a built manifest when
there's no `assetMap` config to walk. `KICK_ASSETS_ROOT` still wins as an
explicit override; production behaviour is unchanged.
