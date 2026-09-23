---
'@forinda/kickjs-cli': minor
---

`kick new` resolves third-party dependency versions from the registry instead of the ranges pinned in the CLI. A new project now gets today's React, Vitest, oxlint, `@types/*` and friends without waiting for a CLI release — and the two templates can no longer drift apart, as they had (the fullstack web app scaffolded `vite ^7` and `typescript ^5.9` while the server package used `vite ^8` and `typescript ^7`).

Packages whose major the generated code is written against stay capped to that major: `vite`, `typescript`, the HTTP engines (`express`, `fastify`, `@fastify/middie`, `h3`, `serve-static`) and the schema libraries (`zod`, `valibot`, `yup`). Everything else tracks `latest`. When `npm view` answers nothing — offline, registry down — each package falls back to the range it shipped with, so the scaffold still writes a valid manifest (installing it then needs a warm package-manager cache or a reachable registry, as any install does).
