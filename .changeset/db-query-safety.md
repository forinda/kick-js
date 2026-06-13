---
'@forinda/kickjs-db': minor
---

Two query-layer safety additions:

- **`escapeLike(input)` / `likePattern(input, mode)`** — escape LIKE/ILIKE metacharacters (`%`, `_`, and the escape char) so user search text matches literally. Without this, a user searching for `100%` produces a match-all pattern (or, with a leading wildcard, a full scan). `likePattern` builds the wrapped pattern for `'contains'` / `'startsWith'` / `'endsWith'` / `'exact'`.
- **Explicit dialect tagging** — `pgDialect` / `mysqlDialect` / `sqliteDialect` now stamp a non-enumerable `KICK_DIALECT` marker, and `createDbClient`'s dialect detection reads it first. Previously detection relied solely on Kysely ctor-name regex (`/Postgres/i`) with a **silent fallback to SQLite** — a hand-rolled or future Kysely dialect whose ctor name didn't match was misclassified, emitting the wrong JSON-aggregation SQL. The ctor-name heuristic remains as the fallback for raw Kysely dialects. `markDialect` / `readDialectMark` are exported for adopters wrapping a raw dialect.
