---
'@forinda/kickjs': patch
---

fix(assets): always return posix paths from `resolveAsset` / `assets.x.y()` / `useAssets()`

`resolveAsset` now normalises returned paths to forward slashes on every platform. On Windows, it previously emitted native paths (`C:\Users\foo\dist\mails\welcome.ejs`), which broke:

- splicing the result into URLs (`href` / `src` / CDN keys) — backslashes are invalid in URLs and silently corrupt the link
- cross-host equality comparisons (a path produced on Windows vs. one on Linux)
- substring assertions in adopters' tests

Node's `fs.*` and Express's path-handling APIs accept either separator on Windows, so this change is safe for the common consumers — `express.static`, `res.sendFile`, `ejs.renderFile`, etc. The only adopter code it could break is something explicitly parsing Windows backslashes back out of the result, which would already be brittle.

The internal manifest stays unchanged on disk; normalisation happens at the public-API boundary in `resolveAsset` only. The same value is then surfaced through `assets.x.y()`, `useAssets()`, and the `@Asset()` decorator.
