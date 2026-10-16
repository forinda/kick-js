---
'@forinda/kickjs-cli': patch
---

The in-memory repository `kick g module` and `kick g scaffold` generate now honours the parsed query in `findPaginated`: filters (all operators — `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `contains`, `starts`, `ends`), `?q=` search across the module's searchable fields, and multi-key sort, applied before `total` is counted and the page sliced. It used to return every record in insertion order whatever the query said. The generated repository and controller tests cover it.
