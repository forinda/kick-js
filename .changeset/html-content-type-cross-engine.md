---
'@forinda/kickjs': patch
---

Fix `ctx.html()` sending a malformed `Content-Type` on the Fastify and h3 runtimes.

`ctx.html()` passed the `'html'` **shorthand** to the response driver's `type()`. That is an Express affordance — `res.type()` runs the value through a MIME lookup and produces `text/html; charset=utf-8`. The Fastify and h3 drivers forward the string verbatim to `reply.type()` / `setHeader('content-type', …)`, so those engines were putting a literal, invalid `Content-Type: html` on the wire.

Express was always correct; Fastify and h3 were not. It went unnoticed because the conformance assertion was `toMatch(/html/)`, which the bogus `html` header satisfies. Fastify 5.10.0 began normalising the invalid value to `text/plain; charset=utf-8`, which is what finally surfaced it.

`ctx.html()` now passes the full MIME type. Output on Express is unchanged, and Fastify and h3 emit `text/html; charset=utf-8` like they always should have. The conformance assertion is anchored to `/^text\/html\b/` so the loose form cannot hide a regression again.

If you serve HTML from a Fastify or h3 app, browsers were receiving an unrecognised content type — most render it as plain text. No action needed beyond upgrading.
