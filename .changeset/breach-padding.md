---
'@forinda/kickjs': minor
---

`breachPadding()` is an opt-in BREACH mitigation for `compression()`. Mount it before `compression()`, and each gzip response gets 0–99 random bytes in its header's file-name field (Django's "Heal The Breach"). Decompressors ignore these bytes, but they stop compressed size from revealing a secret. Brotli has no such header field, so the middleware removes `br` and `zstd` from `Accept-Encoding` and clients get gzip instead. It works on Express, Fastify and h3.
