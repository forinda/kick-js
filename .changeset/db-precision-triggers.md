---
'@forinda/kickjs-db': minor
---

- `timestamp({ precision: 3 })`, `timestamptz(…)` and `time(…)` — fractional-second digits, 0–6. Emitted as `timestamp(3)` / `TIMESTAMP(3)`, kept through MySQL's `MODIFY`, and a MySQL `defaultNow()` on such a column uses `CURRENT_TIMESTAMP(3)`. Postgres introspection reads the precision back (a bare type when it's the default 6), so drift and `kick db introspect` see it.
- A SQLite table rebuild keeps the table's hand-written triggers: the migration reads them first and creates them again after, in the same transaction. One that uses a column the rebuild drops is refused before anything runs, instead of being created to fail on every write.
