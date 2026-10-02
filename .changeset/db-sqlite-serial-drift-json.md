---
'@forinda/kickjs-db': patch
---

Two SQLite fixes:

- A table keyed by `serial()` no longer reads as drift on every `migrate latest` after the first ("Schema drift detected: 0 added, 0 removed, 1 changed"). SQLite reports an inline `INTEGER PRIMARY KEY` as nullable; drift now treats every primary-key column as not null.
- `json()`, `jsonb()` and `.array()` columns work: values are stored as JSON text and read back as what was written, at the top level and in nested `db.query` rows. Writing an object or array used to throw "SQLite3 can only bind numbers, strings, bigints, buffers, and null".
