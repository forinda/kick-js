---
'@forinda/kickjs-cli': patch
---

Fix `typegen failed (routeFlags is not iterable)` on projects with a warm scanner cache.

Adding `routeFlags` to `FileExtract` did not bump `CACHE_VERSION` or extend the
cached-entry validator, so every project that had run typegen before route flags
shipped served v2 entries lacking the field and crashed in the join phase. The
only workaround was deleting `.kickjs/cache/scan.json` by hand.

The cache version is bumped (stale entries are ignored), the validator now
rejects an entry missing `routeFlags`, and a compile-time check makes the key
list impossible to forget: adding an array field to `FileExtract` now fails to
build until the validator lists it.
