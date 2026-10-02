---
'@forinda/kickjs-db': minor
---

`db.query.X.findManyAndCount(options)` returns one page and the total number of rows `where` matches before `limit` / `offset`, as `{ data, total }` — the shape `ctx.paginate` takes. The count runs as a second query with the same `where` and soft-delete filter, ignoring `with`, `orderBy` and paging; `total` is always a number, including on Postgres.
