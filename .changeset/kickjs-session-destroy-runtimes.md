---
'@forinda/kickjs': patch
---

`ctx.session.destroy()` works on Fastify and h3. It cleared the cookie with Express's `res.clearCookie`, which those runtimes' responses don't have, so the request failed with a 500; it now expires the cookie the same runtime-neutral way the middleware sets it.
