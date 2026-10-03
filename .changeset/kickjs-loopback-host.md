---
'@forinda/kickjs': patch
---

`Application.fetch()` (and `AdapterContext.fetch`) on Express, Fastify and h3 v1 now delivers the Request's host as `Host`. They forward through an in-process loopback server, and the route saw `Host: 127.0.0.1:<port>` with the real host only in `X-Forwarded-Host`, so tenant-by-host lookups failed for MCP tool calls, AI tool calls and every other in-process call. The host crosses the hop in an internal header that carries a per-instance secret, so a client can't choose it.
