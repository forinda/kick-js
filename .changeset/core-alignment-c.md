---
'@forinda/kickjs': patch
---

Request bodies and cookies behave the same on every engine:

- `jsonLimit` (default `'1mb'`) now applies on Fastify, h3 and the web entry, not only Express. A larger body answers 413. h3 and the web entry used to read bodies with no limit. `createWebApp` takes `jsonLimit` too.
- Form bodies (`application/x-www-form-urlencoded`) turn a repeated field into an array on Fastify, h3 and the web entry, as on Express and as query strings already do.
- Setting two cookies on one response keeps both on Fastify and h3. One was dropped there, so for example `session()` and `csrf()` together could lose a cookie. `ctx.res.setHeader()` replaces a header on Fastify as it does elsewhere.
