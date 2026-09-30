---
'@forinda/kickjs-cli': minor
---

`kick build:netlify` and `kick build:vercel` now generate function entries that pass the platform context to the handler, so `ctx.waitUntil()` work keeps running after the response:

- **Netlify:** `(request, context) => handler.fetch(request, context)`.
- **Vercel:** reads the per-request context Vercel's Node runtime exposes on `globalThis[Symbol.for('@vercel/request-context')]`, the same channel `@vercel/functions` uses. It needs no extra dependency and passes nothing outside Vercel.
