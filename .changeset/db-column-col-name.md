---
'@forinda/kickjs-db': minor
---

`.colName('EMAIL_ADDR')` on a column: its name in the database when it isn't the key. Code keeps the key — queries, `select *` rows, inserts, updates, upserts, operators and `db.query` (nested rows included) are mapped per table, so `users.email` can be `EMAIL_ADDR` while `posts.email` stays `email`. Migrations use the name for the column, its foreign keys, indexes and derived constraint names; `casing` leaves it as written; `kick db introspect` renders `.colName()` for a name `casing` can't give back.
