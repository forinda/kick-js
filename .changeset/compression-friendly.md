---
'@forinda/kickjs': patch
---

Responses work with the `compression` middleware on every runtime. `ctx.sse()` sends `Cache-Control: no-cache, no-transform`, so compression middleware and proxies no longer hold events back in a gzip buffer. Buffered responses on h3 and the web entry now carry `Content-Length`, as on Express and Fastify, so size-based decisions (compression's 1 KB threshold) apply and small replies skip chunked encoding.
