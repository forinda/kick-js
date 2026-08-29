---
'@forinda/kickjs-cli': patch
---

`kick new`: stop pinning siblings to the CLI's own version when the registry query fails

`resolveSiblingVersions()` queries `npm view <pkg> version` per package and fell
back to the CLI's own version on failure. Sibling packages version
independently, so that fallback names a release that does not exist and the
scaffold died at install time:

```text
npm error 404 '@forinda/kickjs-vite@^6.14.1' is not in this registry
```

Three changes:

- The fallback is now `latest`, which always resolves. `@forinda/kickjs-cli`
  keeps the version pin, since there it is genuinely the right one.
- The queries actually run concurrently. `captureCommand` is `execFileSync`, so
  the existing `Promise.all` ran all ten serially — new `captureCommandAsync`
  fixes that.
- The per-query timeout goes from 5s to 20s. A warm `npm view` against the
  public registry measures 0.6–3.6s per package, so 5s was one slow response
  away from expiring.

A scaffold that had to fall back now says so instead of failing later.
