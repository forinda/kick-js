---
'@forinda/kickjs': patch
---

Validation and request-body parsing now work under the Fastify runtime.

- **Validation**: the Fastify route handler now runs the route's `@Get(path, schema)` / `route.validation` schema (it previously skipped it, so validated routes weren't actually validated on Fastify). `validate` is a connect-style middleware that parses `req.body` / `query` / `params` and rejects via `next(err)` → a 422 through the error handler — same as Express.
- **Body parsing**: a new `nativeBodyParsing` runtime capability. Fastify parses bodies itself, so the Application now skips its default `express.json()` on Fastify — previously both ran, the body stream was read twice, and the request hung. Express keeps `express.json()` (capability is `false`).
- **Root paths**: a controller `@Post('/')` now mounts at the module prefix itself on Fastify (not `${prefix}/`), so requests without a trailing slash match.

Conformance suite now covers body validation (valid → parsed, invalid → rejected) under both Express and Fastify. kickjs 572 green.
