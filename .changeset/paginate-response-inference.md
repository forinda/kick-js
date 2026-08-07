---
'@forinda/kickjs': minor
---

`ctx.paginate()` returns its payload, so response inference is exact

`paginate` ended with `return this.json(response)`, handing back the engine's
`RuntimeResponse`. The documented usage is `return ctx.paginate(...)`, so
typegen emitted `response: RuntimeResponse` into `KickRoutes[...].response` and
`@forinda/kickjs-client` offered `.status()` / `.setHeader()` where the caller
expected `data` and `meta`.

It now sends as before **and** returns the payload, typed
`Promise<PaginatedResponse<T>>`. That routes it through the same return-value
inference that already handles `return user` and `return reply(201, user)`,
rather than adding a second mechanism beside `reply`. Handlers that call
`paginate` without returning it still respond — the runtimes only auto-send a
returned value when nothing was written (`if (!res.headersSent)`), so there is
no double send.

`InferHandlerResponse` also maps a bare `RuntimeResponse` to `unknown`. A
handler ending `return ctx.json(user)` previously emitted the engine response
object into client types — confidently wrong rather than merely imprecise, and
contradicting typegen's own comment that imperative handlers "degrade to
unknown". They now do. To carry a payload type, return the value or wrap it
with `reply`.
