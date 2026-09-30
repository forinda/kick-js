---
'@forinda/kickjs': patch
---

h3 runtime: a handler that throws `HttpException(404, '…')` now gets the error handler's problem-details response with its `detail`, as on Express and Fastify.

Before, h3 treated any error with status 404 as "no route matched" and sent it to the not-found handler. That dropped the message and skipped the error handler. Only the router's own no-match now counts as not found.
