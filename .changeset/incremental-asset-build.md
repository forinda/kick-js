---
'@forinda/kickjs-cli': minor
---

Incremental asset builds — `buildAssets` no longer re-copies every file on each run.

`kick build` / `kick build:assets` now skip copying any asset whose destination is already up to date (exists, same byte size, mtime ≥ source), turning a no-change rebuild into a cheap stat sweep instead of a full re-copy. The `.kickjs-assets.json` manifest is still written with every matched file, so output is identical — only redundant copies are elided. `BuildAssetsEntryResult.filesCopied` now reports the number of files actually written (0 when nothing changed).

`kick dev` wires this into the watcher: when an `assetMap.<ns>.src` directory changes, it runs the incremental asset build (debounced, alongside typegen) so the dist copies + manifest stay fresh without rebuilding everything on every save.
