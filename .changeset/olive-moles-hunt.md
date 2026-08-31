---
'@forinda/kickjs': patch
---

Fix the h3 runtime answering 200 for a malformed request body.

The h3 runtime read bodies with `readBody(event).catch(() => undefined)`. That
catch was there for the legitimate absent-body case, but it swallowed a PARSE
failure just as readily — so broken JSON produced a **200**, with the handler
running against `undefined`:

| runtime | malformed JSON                                   |
| ------- | ------------------------------------------------ |
| express | `400 {"message":"Unexpected end of JSON input"}` |
| fastify | `400 {"message":"Body is not valid JSON…"}`      |
| h3      | `200 {"got":null}`                               |

Worse than the wrong status: the client was told it succeeded, and the handler
executed on data that never parsed — a create endpoint would write whatever its
defaults were.

The runtime now only skips the read when nothing was sent, deciding on
`content-length` / `transfer-encoding` rather than on whether parsing threw.
A body that is present but unparseable raises `HttpException.badRequest`, so all
three runtimes answer 400.

Covered by a matrix over all three: malformed JSON is rejected and the handler
does not run, a well-formed body still works, and a request with no body at all
still succeeds — that last one being why the original catch existed.

The same comparison turned up a second h3 divergence, also fixed here. h3 routes
every thrown value through `createError()`, which returns its own error with the
original on `cause`, and that wrapper was handed to the shared error middleware.
Express and Fastify hand it the original, so responses differed by runtime for
the same thrown value:

| thrown                                | express / fastify             | h3 (before)                                 |
| ------------------------------------- | ----------------------------- | ------------------------------------------- |
| `HttpException(418, 'I am a teapot')` | `{"message":"I am a teapot"}` | `{"message":"I am a teapot","requestId":…}` |
| `new Error('kaboom')` → `error` field | `Error: kaboom`               | `Error: kaboom ← caused by Error: kaboom`   |

`instanceof HttpException` failed against the wrapper, so an expected 4xx fell
through to the generic branch and picked up a `requestId` the other runtimes
omit for that case. The runtime now unwraps an `Error` cause before delegating.
h3's own 404 carries no cause, so the not-found path is untouched.

A parity suite pins the catch-all and error mapping on all three: unknown route
under the prefix, unknown route at the root, known path with the wrong method,
`HttpException` status and body, an unexpected throw naming the error once with
a correlation id, and a working route.
