---
'@forinda/kickjs': minor
'@forinda/kickjs-swagger': patch
---

Query sort accepts `-field` (descending) and `field` / `+field` (ascending), repeated or comma-separated, alongside `field:asc|desc`: `?sort=-featured,price` is the same as `?sort=featured:desc&sort=price:asc`. A bare field and comma lists were dropped before. `buildQueryParams` still writes the `field:dir` form.
