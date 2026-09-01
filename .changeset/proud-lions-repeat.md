---
'@forinda/kickjs': minor
---

Every error the framework serialises is RFC 9457 problem details.

A plain `HttpException` answered a bare `{ "message": … }` with
`application/json`, while `ProblemException` and `ctx.problem.*` answered
`application/problem+json`. So `HttpException` was the one shape a client
parsing problem details had to special-case — and the most common one, since it
is how most apps reject a request. The same situation the v8 catch-all change
removed, in the path it did not reach (#611).

```ts
throw HttpException.forbidden('Not your project')
```

```json
403  content-type: application/problem+json
{ "type": "about:blank", "title": "Forbidden", "status": 403, "detail": "Not your project" }
```

The message becomes `detail`; `title` and `type` default from the status.
`details` becomes an `errors` extension member, permitted by §3.2 and still
withheld in production for the same reason as before — it can carry the shape
of the request that failed. Route validation raises `HttpException`, so 422
bodies move with it.

**Migrating:** assert on `body.detail` rather than `body.message`. Nothing is
lost, it is renamed to the RFC's field.

Released as a **minor** rather than a major, deliberately. The response shape
does change, so semver would argue for a major — but 8.0.0 shipped a day
earlier, and moving to 9.0.0 for this would say something much louder about the
release cadence than about the change. The window where an adopter has pinned
`{ message }` against 8.0.0 specifically is roughly that one day.

The error handler's own contract previously said `HttpException` "keeps the
existing `{ message, errors? }` shape for backward compatibility". That clause
is gone — it was cheapest to drop inside the v8 window, and keeping it meant the
framework shipped two error shapes and no rule for which one an app would get.

Reported against contributors, which is where it is most visible: a contributor
is the natural place to authorise, and answering off-spec there pushed
authorisation checks back into `@Middleware()` for the wrong reason. Contributors
could always reach `ctx.problem.*` — `resolve()` gets a full `RequestContext` —
but should not have had to in order to get a conformant body. Both guides now
say which to reach for and why.
