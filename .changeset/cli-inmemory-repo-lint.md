---
'@forinda/kickjs-cli': patch
---

The repository `kick g module` generates passes `vp check` / type-aware oxlint with no warnings: stored values are turned into text for search, filters and sorting by a small `asText()` helper instead of `String(value)` on an `unknown`, which the `no-base-to-string` rule flagged (an object field would have read as `[object Object]`).
