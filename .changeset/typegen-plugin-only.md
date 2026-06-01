---
'@forinda/kickjs-cli': patch
---

Make `kick typegen` fully plugin-based and retire the legacy monolithic generator.

The `KickJsRegistry`, `ServiceToken`/`ModuleToken` unions, `KickJsPluginRegistry`, and the `defineAugmentation` catalogue are now each emitted by their own typegen plugin (`kick/registry`, `kick/services`, `kick/modules`, `kick/plugins`, `kick/augmentations`) — joining the already-carved `kick/routes`, `kick/env`, `kick/assets`, `kick/db`. `typegen/generator.ts` is removed; `runTypegen` now just scans, gates collisions, runs the plugin pipeline, and finalises.

Effects:

- Output files are renamed to the uniform `kick__*` scheme (`kick__registry.d.ts`, `kick__services.d.ts`, …). The barrel `index.d.ts` is dropped — the scaffolded tsconfig pulls `.kickjs/types/**` in via `include`, so augmentations apply by inclusion and the barrel's re-exports were redundant.
- The whole pipeline is now uniformly per-plugin-isolated (a throw in one plugin can't block the others).
- Upgrading is automatic: the first run sweeps the old `index.d.ts` / `registry.d.ts` / `services.d.ts` / `modules.d.ts` / `plugins.d.ts` / `augmentations.d.ts` files.

Tracking issue #309.
