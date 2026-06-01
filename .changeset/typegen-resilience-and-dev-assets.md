---
'@forinda/kickjs-cli': patch
'@forinda/kickjs': patch
---

Fix asset manager interfering with controller typegen, and make `assets.x.y()` resolve in dev for `kick.config.ts` projects.

- **Typegen runner is now per-plugin isolated.** A throw in one typegen plugin (e.g. `kick/assets`) no longer aborts the whole pass — it's reported as an `error` and the remaining plugins (e.g. `kick/routes`) still run. Previously one failing plugin left the controller route types ungenerated.
- **The stale-file sweep is now an allowlist, not a denylist.** It only removes the known pre-carve legacy filenames (`assets.d.ts`, `env.ts`, `routes.ts`) and never touches unknown/custom files. Previously, when the plugin pass returned nothing (e.g. it aborted), the sweep deleted live `kick__routes.ts` / `kick__assets.d.ts` — wiping controller types project-wide.
- **Dev-mode asset resolution now works with `kick.config.ts`.** The runtime resolver reads config synchronously and can't transpile TS, so a `.ts`-config project had no manifest to resolve from until the first production build (`assets.x.y()` threw `UnknownAssetError`). The CLI now mirrors the JSON-serialisable `assetMap` + `build.outDir` into `.kickjs/kick.config.json` whenever it loads the config, and the runtime resolver reads that snapshot as a fallback.
