---
'@forinda/kickjs-cli': patch
---

`kick typegen --no-cache` disables the persistent per-file scan cache, re-reading and re-extracting every source file from cold. Escape hatch for the rare `mtimeMs:size` signature collision (a file edited fast enough that its mtime + size are unchanged) where the cache would otherwise serve a stale extract — previously the only recovery was manually deleting `.kickjs/cache`. `runTypegen({ noCache: true })` exposes the same on the programmatic API.
