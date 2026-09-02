---
'@forinda/kickjs': patch
---

Correct the `ModuleRoutes.prefix` JSDoc. It said `prefix: false` mounts "at `path` exactly", but the flag only drops `apiPrefix` — the `/v{n}` segment stays, so `{ path: '/x', prefix: false }` mounts at `/v1/x` under `defaultVersion: 1`. Mounting at `path` exactly takes `version: false` as well, which is what the built-in health module sets. Comment only; the behaviour is unchanged.
