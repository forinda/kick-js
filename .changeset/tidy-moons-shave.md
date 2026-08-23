---
'@forinda/kickjs-cli': minor
---

`kick g middleware` now types the handler for the project's configured runtime.

With `runtime: 'express'` in `kick.config.ts` it emits
`(req: Request, res: Response, next: NextFunction)` from `express` — those
scaffolds already carry `@types/express`, and only Express hands the handler its
own request/response, so `req.originalUrl` and `res.json()` stop needing a cast.
Fastify and h3 keep `node:http` types, which is what they actually receive
(`request.raw` under Fastify, the node objects under h3).

The express shape is opt-in on an explicit `runtime: 'express'`, never on an
absent field: an unset `runtime` means a hand-written or pre-`--runtime` config
that says nothing about the engine, and emitting `express` imports there is
exactly how the original cross-runtime bug shipped.
