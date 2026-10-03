---
'@forinda/kickjs-db': minor
---

More column options (D.24).

- **JS-side defaults:**
  - `.$defaultFn(fn)` fills a column per inserted row that leaves it out, including the rows of a multi-row insert.
  - `.$onUpdate(fn)` sets it on every update and every upsert update branch that doesn't set it.
- **`mode` for big and exact numbers:** `bigint({ mode: 'bigint' | 'number' | 'string' })` and `numeric(p, s, { mode: 'number' | 'string' })`.
  - The value is read back as that type, top level and in `db.query` nested rows, and validators follow.
  - Without `mode`, nothing changes.
- **Comments:** `.comment(text)` on columns, and `table(name, columns, { comment, constraints })` for tables.
  - Postgres: migrated with `COMMENT ON`. MySQL: inline, or by restating the column, keeping `AUTO_INCREMENT` on a serial key.
  - Read back by introspection and `kick db introspect`. SQLite ignores them.
  - MySQL column definitions now always carry their comment, so a column alter no longer erases it.
- **Postgres:** `halfvec(n)`, `point()` (`{ x, y }`), `geometry(type?, srid?)`, `macaddr()` and `macaddr8()`.
  - Fix: `vector(n)` now reads and writes `number[]`. It used to return the text `'[1,2,3]'` and send arrays as Postgres array literals.
- **MySQL:** `mysqlEnum(...values)` (typed union; values keep their case through emit, introspection and validators), `unsigned(col)`, `tinyint()`, `mediumint()` and `datetime(fsp?)`.
