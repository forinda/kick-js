---
'@forinda/kickjs-cli': patch
---

`kick new`'s starter `hello` module no longer serves `GET /hello/health` (and `HelloService.healthCheck()` is gone). The framework already answers `/health/live` and `/health/ready`; the fullstack template's web page stops calling the removed route.
