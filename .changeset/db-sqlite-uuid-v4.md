---
'@forinda/kickjs-db': patch
---

`uuid().defaultRandom()` on SQLite now generates a canonical version-4 UUID (`8-4-4-4-12`), not 32 bare hex characters — so a generated id passes the same UUID validation a Postgres one does (`z.uuid()` rejected it before). Applies to tables created or rebuilt by migrations generated from now on; existing columns keep their old default until the table is next rebuilt. Drift checks ignore SQLite defaults, so no drift is reported either way.
