---
'@forinda/kickjs-storage': patch
---

tus no longer stores a finished upload with the client's declared `metadata.filetype` as its `Content-Type`, because a client could declare `text/html` or `image/svg+xml` and get a page that runs script served from your storage. Files are stored as `application/octet-stream` unless `onCreate` returns a `contentType`, which must be one exact type and is meant to be checked against your allowlist.
