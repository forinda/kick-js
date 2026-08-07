---
'@forinda/kickjs-cli': patch
'@forinda/kickjs': patch
---

Generated guards, middleware, and the default error handler stop assuming Express

Three places emitted or ran Express-only code under a framework that advertises
a pluggable engine. All three were invisible because the default runtime is
Express.

**`kick g middleware`** emitted `import type { Request, Response, NextFunction }
from 'express'`. A Fastify or h3 scaffold has neither `express` nor
`@types/express` — it installs `fastify` + `@fastify/middie` — so that was a
compile error on a freshly generated file. Now typed from `node:http`, which is
what the connect-style handler actually receives on every engine.

**`kick g guard`** emitted `ctx.res.status(401).json(...)`. `ctx.res` is the
ENGINE-NATIVE response: `FastifyReply` has no `.json()` (verified against
Fastify's own types) and h3's event has no `.status()`. Now uses
`ctx.problem.unauthorized({ detail })` — RFC 9457, engine-neutral, and what the
error-branch guidance in the controllers guide already teaches.

**The default `errorHandler()`** read `req.originalUrl`, which only Express
adds. Fastify and h3 pass `request.raw`, so every error logged
`GET undefined — <error>`: the path silently dropped from the one line meant to
identify the failing request. It now falls back to `req.url`, and both it and
`notFoundHandler()` are typed from node / `RuntimeResponse` rather than Express.
