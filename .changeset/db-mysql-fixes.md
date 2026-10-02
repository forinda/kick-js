---
'@forinda/kickjs-db': patch
---

MySQL works as documented, end to end:

- `mysqlDialect({ pool })` with a `mysql2/promise` pool — the same pool `mysqlAdapter` takes — no longer hangs on every query. Kysely drives mysql2's callback API, which a promise pool ignores; the dialect now hands Kysely the pool's callback core.
- A real mysql2 `Pool` satisfies `MysqlPoolLike` without a cast (its query values are mutable; the type said `readonly`).
- After a migration with a foreign key on a column with no index of its own, the next `migrate latest` no longer fails with "Schema drift detected": the index InnoDB creates for the foreign key isn't counted as drift.
- `mysqlAdapter` and `pgAdapter` take `endPoolOnClose: true` for a pool the adapter owns — a `kick.config.ts` `db.adapter()` factory that opens one for the CLI — so `kick db` exits when it's done instead of waiting on the open pool.

Rows nested by `db.query` decode their dates on Postgres and MySQL too, as they already did on SQLite: `timestamp`, `timestamptz` and `date` columns come back as `Date`, read the way the driver reads the same column at the top level (on MySQL, in the pool's `timezone`).
