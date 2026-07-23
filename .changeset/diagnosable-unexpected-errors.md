---
'@forinda/kickjs': minor
---

Make an unexpected 500 diagnosable. Previously it told you nothing on either side at once — an adopter hitting a missing-table error had to go to the database to find out what happened.

**`Logger.error(err, msg)` discarded the error object.** The error-first form is the framework's own idiom at ~16 call sites (`error-handler`, `application`, `bootstrap`, `request-scope`, plus the `ai` and `mcp` adapters), and every one of them was logging a bare sentence: the implementation called `provider.error(msg)` with the error appearing nowhere in the call, so **no stack, no error name, no `cause` chain** ever reached the log. The error is now forwarded to the provider as a trailing argument — `console` renders the full stack, and pino/winston adapters receive it as structured extra. The message-first form (`log.error('save failed', { id })`) was dropping its trailing args for the same reason; also fixed.

**Unexpected 500 responses carry a correlation id and, outside production, real detail.** The body was a bare `{ message: 'Internal Server Error' }` in every environment. It now always includes `requestId` (from the request-scoped id, falling back to the inbound `x-request-id` header, omitted when neither exists) — without it an opaque 500 can't be tied to its own log line. Outside production the body also carries `error` (an error summary that walks the `cause` chain, which is where ORM and driver errors hide the reason that matters) and `stack`. Production bodies stay opaque: no message, no stack.

**The web/edge error fallbacks were completely silent.** `web/handler.ts` and the h3 v2 runtime emitted `{ error: 'Internal Server Error' }` with no log call at all, so a failure reaching those last-resort branches left no trace anywhere. Both now log the error and include the summary outside production.

**New `describeError(err)` export** — one-line error summary including the error name and `cause` chain, depth-capped and cycle-guarded. Used by the error paths above; exported because adopters writing a custom `onError` want the same thing.

**Edge-safety fix:** `logger.ts` read `process.env.LOG_LEVEL` unguarded, so importing it from a strict edge runtime with no `process` global threw. The colour probe next to it was already guarded; this one wasn't. It matters now that the edge-safe web pipeline imports the logger.

The cross-runtime conformance test for thrown errors now asserts the shared invariant (500 + opaque message + a `requestId`) rather than deep-equalling the old bare body, and passes on express, fastify, and h3 alike.
