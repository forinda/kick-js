---
'@forinda/kickjs-grpc': patch
---

Docs: native gRPC works from the app itself on the Fastify and h3 runtimes with `server: { tls, http2: true }` — no proxy needed. The guide, README and JSDoc said it always needed an HTTP/2 proxy in front.
