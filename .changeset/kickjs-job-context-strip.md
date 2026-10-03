---
'@forinda/kickjs': patch
---

`stampJobContext(data)` always removes a `__kickContext` already in `data`. Only the dispatcher's own context travels, so a job enqueued from a request body can't choose its tenant.

`runJob` drops a `__kickContext` that isn't a plain object (a string, array, number or `null`) instead of reading entries from it.
