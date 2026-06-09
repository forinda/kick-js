---
'@forinda/kickjs-cli': minor
---

Speed up `kick typegen` / `kick dev` / `kick build` on large projects with a persistent, incremental scanner.

The typegen scanner used to re-read and re-regex every `src/**/*.ts` file on every run, serially. Two changes cut that cost:

- **Persistent per-file cache** (`.kickjs/cache/scan.json`, already gitignored): each file's extraction is cached keyed by a cheap `mtimeMs:size` signature, so a watch/rebuild only re-reads genuinely-changed files. Reads + extraction now also run concurrently. Warm scans are ~3× faster than a cold scan.
- **Walk-free incremental scan in `kick dev`**: the dev server feeds Vite's exact chokidar delta to the scanner, which re-extracts only the changed files and skips the directory walk entirely — ~2.8× faster again than a warm full scan (≈8.5× over the original cold scan on a 1,500-module project).

Correctness is preserved: the cross-file join (mount-prefix route params, glob-orphan detection) always re-runs over the full cached + fresh extract set, so cached entries can never desync output. File deletions are handled — single-file `unlink` events drop the file from the scan and prune the cache; a directory `unlinkDir` (which carries no precise per-file delta) falls back to a full re-scan. No public API or config changes; the cache is transparent and self-healing (a missing or version-mismatched cache simply behaves like a cold first run).
