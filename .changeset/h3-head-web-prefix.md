---
'@forinda/kickjs': patch
---

On h3 and the web entry, `HEAD` answers every `GET` route with its status and headers and no body, as on Express and Fastify (it was 404/405). The web entry also honours a module route's `prefix: false`, mounting it at the root instead of under `apiPrefix`.
