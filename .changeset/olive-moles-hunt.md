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
