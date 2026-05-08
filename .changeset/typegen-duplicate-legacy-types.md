---
'@forinda/kickjs-cli': patch
---

Fix duplicate `KickAssets` augmentation in `.kickjs/types/`.

The legacy generator kept emitting `assets.d.ts` after the `kick/assets`
typegen plugin carved out (M2.B-T8), so adopters got two declarations of
`interface KickAssets` — one in `assets.d.ts`, one in `kick__assets.d.ts`.
TypeScript merged them silently, but the next field rename or removal
would surface as TS2717. The plugin is now the sole owner of the
augmentation.

`kick typegen` (and `kick dev`'s typegen pass) now sweep stale
top-level files in `.kickjs/types/` against the union of generator +
plugin outputs, so projects upgrading from older CLI versions self-heal
the orphaned `env.ts` / `routes.ts` / `assets.d.ts` from the M2.B-T8
carve in one run. The output dir is fully owned by typegen (writes its
own `.gitignore`), so this is non-destructive.

`index.d.ts` now omits the `import './kick__assets'` side-effect line
when the project has no `assetMap` entries — the plugin skips emission
in that case, so importing it would dangle.
