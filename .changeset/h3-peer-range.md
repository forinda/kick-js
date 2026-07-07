---
'@forinda/kickjs': patch
---

fix: installing alongside `h3@latest` (the v2 RC line) no longer fails with ERESOLVE

The `h3` peer range could not admit h3's RC releases: semver only lets a
prerelease satisfy a range whose comparator shares its exact
`major.minor.patch` tuple, and the RC line moves tuples (`2.0.1-rc.23`).
No static range can express "any 2.x prerelease", so the optional `h3`
peer declaration is removed entirely — the h3 runtimes already fail fast
at load with clear guidance when the wrong major is installed (v1 for
`h3Runtime()`, v2 for `h3WebRuntime()` / `@forinda/kickjs/web`). The peer
constraint will return as `^1 || ^2` once h3 v2 ships stable.
