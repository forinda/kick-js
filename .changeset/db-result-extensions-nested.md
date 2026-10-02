---
'@forinda/kickjs-db': patch
---

`$extends({ result })` computeds now apply to related rows that `db.query` loads through `with`, at every level. The types already promised them, but they were missing at runtime.
