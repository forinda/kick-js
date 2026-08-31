---
'@forinda/kickjs': patch
---

Answer 413 / 415 for a rejected upload on Express, matching the other runtimes.

`@FileUpload` enforces `maxSize` and `allowedTypes` through a different backend
per engine — Multer under Express, `@fastify/multipart` under Fastify,
`readMultipartFormData` under h3 — and only two of the three reported a
violation as the client's:

| upload          | express                                                                | fastify / h3                                   |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| over `maxSize`  | **500** `MulterError: File too large`, with a Multer stack in the body | `413` `File big.txt exceeds the 16-byte limit` |
| disallowed type | **500** `Error: File type text/plain is not allowed`                   | `415` `File type text/plain is not allowed`    |

So an Express app told the client it had itself failed, for a file the client
chose — and leaked a Multer stack trace doing it.

Multer's `LIMIT_FILE_SIZE` is now translated to `HttpException(413)` and the
type filter raises `HttpException(415)` directly, matching the messages
`applyUploadConfig` already produced on the other engines.

One difference remains and is documented rather than papered over: on a 413
Express names the form **field** where the others name the **file**, because
Multer's error carries no filename. Status and limit are identical.

Found by running `@FileUpload` and route validation as a runtime matrix.
Validation was already consistent across all three, including that the schema's
transform reaches the handler and not just its check.
