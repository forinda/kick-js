---
'@forinda/kickjs': patch
---

Fix the web entry answering 200 for a malformed request body.

`h3WebRuntime` — the `./web` entry for edge, Bun and Deno — read JSON bodies
with `request.json().catch(() => undefined)`. That catch cannot tell an
**absent** body from an **unparseable** one, so broken JSON produced a **200**
with the handler running against `undefined`.

It is the same defect #586 removed from the node h3 runtime. That fix did not
reach here, because the web entry has its own body-reading path and the runtime
matrix in `body-parse-errors.test.ts` covers express / fastify / h3 but not this
entry — which is exactly why it survived.

Worse than the wrong status: the client is told it succeeded and the handler
executes on data that never parsed, so a create endpoint writes whatever its
defaults are. On the entry used for edge deployments, where it is least likely
to be noticed.

The body is now read once as text, and the decision comes from the request
rather than from whether parsing threw:

- no body, or an empty one, reads as **absent** — `ctx.body` stays undefined and
  the request succeeds, which is the case the original catch existed for and the
  same call the node runtime makes on `content-length: 0`
- a body that is present but unparseable raises `HttpException.badRequest`, so
  all four runtimes answer 400

The parse failure is held rather than thrown at the point of discovery: the
response driver does not exist yet there, so throwing escaped the route and
surfaced as a 500. It is rethrown as the pipeline's first act, where the
existing error path maps it.

Two behaviour changes ride along, both toward parity with the node runtime: a
failed `x-www-form-urlencoded` read now leaves `ctx.body` undefined rather than
`{}`, and an empty body of any type reads as absent rather than as an empty
object.

Covered by two tests on the web runtime — malformed JSON is rejected and the
handler does not run, and a POST with no body at all still succeeds.

Closes #605
