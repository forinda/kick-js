---
'@forinda/kickjs': patch
---

Fix `csrf`, `rateLimit` and `session` breaking on Fastify and h3.

Connect middleware receives an Express response under Express and a raw
`ServerResponse` under Fastify and h3. Three shipped middlewares reached for
Express-only conveniences on it:

| middleware  | call                  | effect on Fastify / h3                                                                                                 |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `csrf`      | `res.cookie()`        | threw before any check ran, so **every request became a 500** — including the safe methods it is meant to wave through |
| `rateLimit` | `res.status().json()` | threw once the limit was hit, and the throw left the request **hanging** instead of answering 429                      |
| `session`   | `res.cookie()`        | threw on every response issuing a session, so no cookie was ever set                                                   |

`csrf` is the worst of the three: an app that mounted it on Fastify or h3 served
500 for everything, which is a hard failure rather than a quiet one — but
`session` failed quietly, and every visitor looked new.

All three now go through `setCookie` / `sendJson` helpers that take the Express
path when it exists — so behaviour under Express is unchanged — and fall back to
`Set-Cookie` and the Node response primitives otherwise.

Found by running the middleware suites as a runtime matrix rather than against
Express alone. The existing "engine-neutral" tests check the helpers
(`resolveClientIp`, `resolvePathname`) in isolation; they never mount a
middleware on an engine, which is why this survived.
