---
'@forinda/kickjs': major
---

The catch-all answers problem details, and 405 when the verb is the problem.

Two breaking changes to responses an app produces without asking for them, which
is why this is a major rather than a minor. Both are reachable through the
existing bootstrap options: `onNotFound` and `onError` still win, so an app that
supplies either is unaffected.

## Migrating

- A client asserting `body.message === 'Not Found'` reads `body.title` or
  `body.status` instead, or passes `bootstrap({ onNotFound })` to restore the
  old shape.
- A client treating "known path, wrong verb" as 404 now sees 405. That is the
  correct answer, but it moves the case from one branch to another.

## The 404 body

It was `{ "message": "Not Found" }` and is now RFC 9457 problem details with
`Content-Type: application/problem+json`:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404 }
```

The catch-all was the last response still emitting a bare `{ message }`, so a
client parsing `application/problem+json` — which the framework already returns
for every `ProblemException` — had to special-case exactly one path. Pass
`bootstrap({ onNotFound })` to restore the old shape or supply any other.

## Wrong verb on a known path

Now 405, not 404, carrying `Allow` as RFC 9110 §15.5.6 requires:

```
DELETE /api/v1/things/1     405   Allow: GET, PATCH
{ "type": "about:blank", "title": "Method Not Allowed", "status": 405,
  "detail": "DELETE is not supported for this resource. Allowed: GET, PATCH." }
```

A 404 there tells a client to stop looking for a resource that is present. The
handler takes the mounted route table — the Application is the only place that
knows the full path, prefix and version joined — and an app that supplies its
own `onNotFound` is unaffected.

## An h3 bug this surfaced

Not breaking — it makes h3 agree with the other two. `NodeResDriver.json()` set
`application/json` unconditionally, clobbering a content-type the caller had
already chosen. Every `application/problem+json` response went out mislabelled
on that runtime alone — not only the new catch-all, but every `ProblemException`
the error handler has ever emitted there.

Covered by a runtime matrix over Express, Fastify and h3: unknown path under the
prefix, unknown path at the root, wrong method with `Allow`, a sibling path that
matches no route, problem+json content type, `HttpException` mapping, and an
unexpected throw.
