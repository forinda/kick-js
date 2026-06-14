---
'@forinda/kickjs': patch
---

Error handling, 404s, and Server-Sent Events now work under the Fastify runtime.

- **Errors / 404**: the Fastify runtime passed the raw node response to the connect-style `errorHandler` / `notFoundHandler`, whose `res.status().json()` calls failed on it. They now receive the `RuntimeResponse` reply driver, so thrown errors map to the proper 500 / problem response and unmatched routes return the standard 404 — same shape as Express.
- **SSE / `ctx.signal`**: `ctx.sse()` and `ctx.signal` register `req.on('close')` / `req.once('close')`, which Fastify's request object doesn't expose. The runtime now hands `ctx` the raw node request (which has the stream events) with Fastify's parsed `body` / `params` / `query` copied onto it, so streaming and request accessors both work.

The conformance suite now runs error, 404, and SSE cases under **both** Express and Fastify (14 cases total).
