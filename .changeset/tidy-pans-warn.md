---
'@forinda/kickjs-cli': patch
'@forinda/kickjs': patch
---

Correct three generator/API docblock claims that did not match runtime behaviour.

`kick g middleware` emits a connect-style `(req, res, next)` factory, but its
docblock recommended `@Middleware(<factory>())`. That decorator invokes its
handler as `(ctx, next)` — two arguments — so the factory's `next` binds to the
response slot, no third argument arrives, and the first `next()` throws
`TypeError: next is not a function` from inside the middleware. The docblock now
names the mismatch and points at `kick g guard` for the ctx-style shape.

`kick g plugin` listed a lifecycle order that did not match `Application`:
`adapters()` is read during construction and `middleware()` mounts before
`modules()`, so a plugin middleware handler cannot resolve anything a plugin
module registers. It also did not mention that `.async()` resolves config inside
`onReady`, past every contribution point.

`KickPlugin.middleware()` and the generated hook both described their return as
"Express middleware". The handlers are mounted through each runtime's
`useConnect` seam and work on Express, Fastify and h3 alike.
