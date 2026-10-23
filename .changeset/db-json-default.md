---
'@forinda/kickjs-db': patch
---

`.default()` with an object or array (`jsonb().default({})`, `jsonb<string[]>().default(['a'])`) stores its JSON text instead of `[object Object]`, and a `Date` default stores its ISO string. `.default()` now accepts the column's own type, so these type-check without a cast.
