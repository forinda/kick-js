---
'@forinda/kickjs': patch
---

`stampJobContext(data)` always removes a `__kickContext` already in `data`. Only the dispatcher's own context travels, so a job enqueued from a request body can't choose its tenant.
