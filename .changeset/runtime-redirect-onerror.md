---
'@forinda/kickjs': patch
---

Fastify: `ctx.redirect()` sends its `Location` header. h3: an `onError` or `onNotFound` that answers asynchronously is waited for, instead of h3 sending its own error response first. Fastify and h3: an async `onError` / `onNotFound` that rejects answers 500 instead of leaving the request open. A returned value's `[RESPOND]` result is awaited when it is any thenable, not only this realm's `Promise`.
