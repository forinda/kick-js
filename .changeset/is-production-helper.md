---
'@forinda/kickjs': patch
---

`csrf()` and `session()` no longer throw on runtimes without `process` when choosing the cookie's `secure` default. Every production check in the framework now reads `NODE_ENV` the same way.
