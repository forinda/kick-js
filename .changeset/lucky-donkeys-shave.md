---
'@forinda/kickjs-cli': patch
---

Skip rebuilding the client route map when nothing it depends on changed.

Producing the map means building a whole TypeScript program over the server —
7.5s and 1.2 GB on a 1,940-route app — and it was paid on every `kick typegen`,
including the many runs where no route had moved. `kick dev` re-runs typegen on
each restart, so the cost scaled with how often you saved a file rather than
with what you changed.

Each run now fingerprints what the map is derived from (project sources,
lockfile, compiler options, CLI version) and skips the pass when it matches the
fingerprint recorded next to the last emitted map. On that same app an unchanged
run drops to 0.85s and 230 MB. The fingerprint hashes file contents, not
mtimes, so a rebuild that rewrites identical bytes still skips; a one-character
source edit does not. `node_modules` is not hashed — the lockfile stands in for
it — and any failure to compute a fingerprint runs the pass, so the fallback is
the old behaviour rather than a stale file.

The record is `.kickjs/cache/client-map.sha1`, inside the already-ignored
`.kickjs/` directory; deleting it forces a rebuild. `kick typegen --check`
leaves it alone, since that flag must not touch the working tree.
