---
'@forinda/kickjs': minor
---

`defaultVersion: false` opts out of URL versioning

`bootstrap({ defaultVersion: false })` drops the `/v{n}` segment, so modules
mount at `/{apiPrefix}/{path}` — `/api/todos` instead of `/api/v1/todos`. Pair
it with `apiPrefix: ''` to mount at the root. `createWebApp` accepts the same
option.

A module's own `version` still wins over the app default in both directions:
an unversioned app can carry a versioned module (`version: 2`), and a
versioned app can carry an unversioned one (`version: false`) — useful for a
webhook or health surface a third party has hardcoded.

Purely additive; the default stays `1`.
