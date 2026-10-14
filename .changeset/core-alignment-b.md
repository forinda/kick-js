---
'@forinda/kickjs': patch
---

One error and not-found shape on every engine:

- `createWebApp` (`@forinda/kickjs/web`) answers errors through the same handler as `bootstrap()`: RFC 9457 problem details, the error's own headers, and `requestId` on a 500. Unmatched paths get the problem-details 404, and a known path with the wrong method gets 405 with `Allow`.
- The h3 runtime falls back to the built-in error and not-found handlers when a configured one fails or doesn't answer, instead of a differently-shaped `{ error }` body.
- Every engine sends `X-Request-Id`. An id already assigned to the request wins over the inbound header on Fastify, as on Express and h3.
- Fastify's instance is closed on shutdown, so its `onClose` hooks run.
- The error handler reads `NODE_ENV` per error and no longer touches `process` where it doesn't exist.
