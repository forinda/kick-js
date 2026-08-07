---
'@forinda/kickjs': minor
---

`onError` / `onNotFound`: document what each runtime actually passes

The docblock called `onError` "the standard Express error-handling signature".
That holds on exactly one of the three runtimes:

|         | `req`            | `res`             | `next`      |
| ------- | ---------------- | ----------------- | ----------- |
| Express | native `Request` | native `Response` | real `next` |
| Fastify | `request.raw`    | reply driver      | **no-op**   |
| h3      | `event.node.req` | response driver   | no-op       |

Two consequences that were undocumented and bite silently:

- **`next(err)` does nothing on Fastify and h3.** It is bound to an inert
  function (`const NOOP_NEXT = (): void => {}`), so a handler that delegates to
  the default handler drops the error instead.
- **Express-only request members are `undefined` elsewhere.** A handler reading
  `req.originalUrl` — as the shipped example did — logs `undefined` on two of
  three engines.

`res` is now typed `RuntimeResponse` rather than `any`, which is what every
engine genuinely provides (`status`, `json`, `send`, `setHeader`, `render`,
`writeHead`, `end`); Express's own `Response` satisfies it. `next` is typed
`(err?: unknown) => void`. `req` stays permissive because it genuinely differs
per engine, and the docblock now says how.

A handler using Express-only _response_ members (`res.locals`, and anything
outside `RuntimeResponse`) will now fail to compile. That is the point: those
members are absent at runtime on Fastify and h3.
