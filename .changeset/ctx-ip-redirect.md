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

Sweeping the same pattern turned up three shipped middlewares reading Express-only
members, all of which receive the RAW node request under Fastify and h3:

- **`rateLimit`** keyed every caller as its `'127.0.0.1'` fallback, because
  `req.ip` is undefined there — a single shared bucket, so one client could
  exhaust the limit for everyone. It now resolves the address the same way
  `ctx.ip` does.
- **`csrf`** matched `ignorePaths` against `req.path`, which is undefined, so
  `has(undefined)` never matched and configured exemptions were silently dead.
  (It failed closed, so CSRF stayed enforced — the feature simply did nothing.)
- **`requestLogger`** THREW `Cannot read properties of undefined (reading
'startsWith')` on every request once any `skip` prefix was configured, and
  logged `GET undefined 200 12ms` otherwise.

The resolution lives in one place (`http/client-ip.ts`) rather than a fourth
copy drifting from the others.
