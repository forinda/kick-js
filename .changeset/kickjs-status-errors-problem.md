---
'@forinda/kickjs': patch
---

An error that isn't an `HttpException` but declares a 4xx status (`err.status` / `err.statusCode`) — kick/db's `UniqueViolationError` (409), an auth check that throws with `status: 401` — is answered like an `HttpException`: RFC 9457 `application/problem+json` with its message as `detail`, logged as a warning. It used to be logged at ERROR with a stack and answered with a bare `{ message, requestId }`. A declared 5xx other than 500 keeps its status but now gets the guarded 500 body; its raw message used to be sent to the client.
