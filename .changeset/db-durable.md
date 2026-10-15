---
'@forinda/kickjs-db': minor
---

`transaction({ durable: true })` must be the outermost transaction, so its work is committed when the callback returns. Inside an open transaction on the call chain it throws instead of quietly joining one that may still roll back. `nested: 'separate'` is allowed, because it commits on its own connection.
