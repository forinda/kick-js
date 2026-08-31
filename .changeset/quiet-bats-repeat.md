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

`csrf` had a second, worse problem on the request side: it read the token from
`req.cookies`, which only an upstream cookie parser populates. Fastify and h3
never have one, and Express only does if the app mounts `cookie-parser` — so the
middleware could not see the cookie it had just issued, minted a fresh token on
every request, and compared the submitted header against that new value. **The
double-submit flow could never succeed on any runtime**, which the "no token →
403" test could not show because a rejection is what it expected either way.

Cookies are now read through a shared `readCookies`, which falls back to parsing
the `Cookie` header — the same fallback `session` already had, now shared rather
than duplicated.

All three now go through `setCookie` / `sendJson` helpers that take the Express
path when it exists — so behaviour under Express is unchanged — and fall back to
`Set-Cookie` and the Node response primitives otherwise.

Found by running the middleware suites as a runtime matrix rather than against
Express alone. The existing "engine-neutral" tests check the helpers
(`resolveClientIp`, `resolvePathname`) in isolation; they never mount a
middleware on an engine, which is why this survived.
