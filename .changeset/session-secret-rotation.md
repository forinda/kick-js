---
'@forinda/kickjs': minor
---

`session({ secret })` accepts a list, so you can rotate the secret without logging everyone out. The first secret signs (or, with `store: 'cookie'`, encrypts) new cookies. Every listed secret is accepted, and a cookie made with an older one is re-issued with the first on the next response.
