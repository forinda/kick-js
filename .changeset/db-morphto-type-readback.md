---
'@forinda/kickjs-db': minor
---

- A `morphTo` subject carries `__type`, the type value it was found by, and is typed as a tagged union — `(Post & { __type: 'post' }) | (Podcast & { __type: 'podcast' }) | null` — so `subject.__type === 'post'` narrows it. Result extensions find the subject's table by it, even when `columns` leaves out the source's type column.
- `insertMany({ returning: true, readBack: ['code'] })` on MySQL, which has no RETURNING: the rows are read back by a unique key every row gives, in input order, inside a transaction (a key that turns out not to be unique rolls the insert back). Without `readBack` the error says what to pass.

Behaviour change: a `morphTo` subject has one more key, `__type`. Code comparing subjects with a deep equality check sees it.
