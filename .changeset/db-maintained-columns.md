---
'@forinda/kickjs-db': minor
---

Columns kick/db maintains (D.10), declared in the schema — no migration involved:

- `.onUpdateNow()` sets a timestamp to the current time on every update that doesn't set it itself, including an upsert's update branch.
- `version()` — an integer, not null, starting at 0 — is incremented on every update; guard an update with `.where('version', '=', read)` for optimistic locking.
- `.softDelete()` marks a nullable timestamp as the deleted flag: relational reads (`db.query`) skip rows where it's set, at every level, unless asked `withDeleted: true`.

They apply to queries kick/db builds; raw SQL and the plain query builder's reads are untouched.
