---
'@forinda/kickjs-db': minor
---

`kick db generate` now emits MySQL DDL when `db.dialect: 'mysql'`. Previously MySQL fell back to the Postgres emitter, which produced double-quoted identifiers and Postgres-only types that MySQL rejects.

`emitMysql` mirrors the Postgres emitter's structure (MySQL has full `ALTER TABLE` support, unlike SQLite) with MySQL-specific output: backtick identifiers, PG→MySQL type mapping (`uuid`→`CHAR(36)`, `boolean`→`TINYINT(1)`, `serial`→`INT ... AUTO_INCREMENT`, `jsonb`→`JSON`, `text`→`TEXT`, length-preserving `varchar(n)`→`VARCHAR(n)`), normalised defaults (`gen_random_uuid()`→`(UUID())`, `now()`→`CURRENT_TIMESTAMP`, `false`→`0`), `alterColumn` via `MODIFY COLUMN`, and `dropForeignKey` via `DROP FOREIGN KEY`. The emitter is dispatched by dialect in `generate()`.
