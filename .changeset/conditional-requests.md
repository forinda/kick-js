---
'@forinda/kickjs': minor
---

`ctx.conditional({ etag, lastModified })` answers conditional requests on every engine. It sets `ETag` and `Last-Modified`, then answers `304 Not Modified` when the client's copy is current, or `412 Precondition Failed` when an `If-Match` / `If-Unmodified-Since` write is based on a stale version. Preconditions are evaluated in RFC 9110 order. It returns `true` when it has answered, so a handler can skip loading the data. `evaluatePreconditions()` is exported for use on its own.
