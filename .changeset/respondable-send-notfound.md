---
'@forinda/kickjs': minor
---

- A handler may return a value carrying `[RESPOND](ctx)` (exported `RESPOND`, `isRespondable`, `Respondable`); it writes its own response, and an async one is awaited so its errors reach the error handler.
- `ctx.send(body, { type, status })` sends a string or bytes with its content type on every engine — XML, CSV, plain text.
- `notFoundFallthrough: false` makes Fastify and h3 answer requests no route matched (`onNotFound`, or the built-in 404 / 405) when the app runs inside another handler, such as `kick dev`, instead of handing them back. The default keeps the hand-back.
- A custom `onNotFound` that calls `next()` now reaches the built-in 404 / 405 handler.
