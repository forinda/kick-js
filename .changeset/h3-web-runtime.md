---
'@forinda/kickjs': minor
---

feat: new `h3WebRuntime()` — h3 v2 web-standards runtime (additive)

`@forinda/kickjs/h3-web` runs KickJS on the h3 v2 engine (WHATWG
Request/Response, `app.fetch`). The existing h3 v1 runtime
(`@forinda/kickjs/h3`) is untouched — adopters keep the old way; v2 is pure
opt-in via `bootstrap({ runtime: h3WebRuntime() })`.

- Shared web driver pair (`WebRequestShim`, `WebResponseDriver`): buffered
  responses build a web `Response`; SSE streams over a `TransformStream`
- Uploads via web `FormData` (no multer)
- `h3` peer widened to `^1.0.0 || ^2.0.0-rc || ^2.0.0`; the runtime fails
  fast with guidance when the wrong major is installed
- `h3WebRuntime({ h3 })` accepts a pre-imported module for bundlers without
  `createRequire` (edge preparation)

Groundwork for the `@forinda/kickjs/web` fetch entry (Bun / Deno /
Cloudflare Workers) — see `web-standards-edge-design.md`.
