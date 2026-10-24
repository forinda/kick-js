---
'@forinda/kickjs-db': patch
---

JSDoc on every column builder and modifier: SQL type per dialect, TS type, and an example (`serial`, `integer`, `varchar`, `uuid`, `jsonb`, `pgEnum`, `citext`, `.notNull()`, `.references()`, `index()`, `unique()` and the rest). `selfRef` shows its docs on hover, and `.softDelete()` notes that `selectFrom` still sees deleted rows.
