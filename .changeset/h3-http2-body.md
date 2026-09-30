---
'@forinda/kickjs': patch
---

h3 runtime: read request bodies sent over HTTP/2 without `content-length`.

HTTP/2 carries a request body in DATA frames. It has no `transfer-encoding`, and `content-length` is optional. The h3 runtime, like h3's own `readRawBody`, decided whether a body was sent from those two headers, so a streamed HTTP/2 body reached the handler as `undefined`. HTTP/2 requests now count as having a body unless they send `content-length: 0`, and a body without a length is read from the stream directly. Fastify was already correct. Express can't run on Node's HTTP/2 compatibility layer at all.
