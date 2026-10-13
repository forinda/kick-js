---
'@forinda/kickjs': patch
---

Fastify: `ctx.redirect()` sends its `Location` header. h3: an `onError` or `onNotFound` that answers asynchronously is waited for, instead of h3 sending its own error response first.
