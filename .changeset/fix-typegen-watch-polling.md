---
'@forinda/kickjs-cli': patch
---

Fix two issues in the plugin-only typegen pipeline (follow-up to the generator.ts retirement):

- **Polling watch never regenerated types.** `kick typegen --watch` / `kick dev` on the polling paths (forced via `KICKJS_WATCH_POLLING`, or the `fs.watch` fallback used on Docker bind mounts / WSL / NFS) ran only the scan + collision gate, not the plugin pass — so no `.kickjs/types/kick__*` file refreshed on change. Both polling paths now drive the full `runLegacy().then(runPlugins)` chain, matching the event-based watcher.
- **`kick dev` startup could abort on a typegen error.** The startup plugin pass + artifact write were unguarded, so a scanner/fs error would exit the dev server with code 1. Now wrapped in try/catch + warn, consistent with the scan/gate pass and the debounced refresh.
