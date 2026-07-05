---
'@forinda/kickjs': patch
---

perf: use Web Crypto (`globalThis.crypto`) instead of `node:crypto` on the request path

`requestScopeMiddleware`, `requestId()`, `csrf()` and `traceContext()` now use
`crypto.randomUUID()` / `crypto.getRandomValues()` — identical output, no
`node:crypto` import. First step toward edge-runtime (WinterCG) portability;
no behavior change on node.
