---
'@forinda/kickjs': minor
---

`server: { http2: 'h2c' }` serves cleartext HTTP/2 on Fastify and h3, for a proxy or service mesh that speaks HTTP/2 to the app — native gRPC behind Envoy or Linkerd without a certificate. There is no HTTP/1.1 fallback on that port; point health probes at the management port. `KickServer` now includes `http2.Http2Server`. `http2: true` without `tls` still fails with `KICK008`, as does `'h2c'` with `tls`.
