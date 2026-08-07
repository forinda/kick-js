---
'@forinda/kickjs': minor
---

Add `ctx.ip` and `ctx.redirect()` — engine-neutral versions of two Express-only patterns

The guide reached for `ctx.req.ip` and `ctx.res.redirect()` because there was
nothing neutral to use. Both are engine-native: `req.ip` is Express-only, and
`res.redirect()` exists on Express and Fastify but not h3. Documentation had to
carry "this breaks on X" caveats instead of showing portable code.

**`ctx.ip`** prefers the address the runtime computed — Express derives `req.ip`
from `trust proxy`, Fastify from `trustProxy` — because raw forwarded headers
are client-**spoofable** on deployments that do not normalize them. It falls back
to `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` only for runtimes that
compute no address (notably the web/edge entry), then to the node socket.

That resolution already existed inside the rate-limit guard; it now lives on the
context and the guard reuses it rather than keeping a second copy.

**`ctx.redirect(url, status = 302)`** writes the status and `Location` header
through the runtime response surface, so it works everywhere. Its docblock warns
against passing an unvalidated user-supplied URL — an attacker-controlled
destination is an open redirect.
