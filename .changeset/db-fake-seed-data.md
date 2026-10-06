---
'@forinda/kickjs-db': minor
---

Generated sample data: `seedFake(db, schema, { counts, seed, overrides })` fills tables with rows that fit the schema — types, lengths, enums, unique columns, foreign keys (parents first, junctions with distinct pairs) — the same every run for the same seed; `fakeRows(table, { count, refs })` makes them without a database. Defaults, serial / identity keys and generated or managed columns are left to the database; a column it can't fill asks for an override.
