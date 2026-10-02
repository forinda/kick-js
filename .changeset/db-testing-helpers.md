---
'@forinda/kickjs-db': minor
---

Test helpers, from `@forinda/kickjs-db/testing`:

- `createTestDb({ schema })` — an in-memory SQLite database with the schema (or `migrationsDir`'s migrations) applied and foreign keys on; one per test file, milliseconds to create.
- `createPgTestDb({ schema, connectionString })` — a throwaway database on an existing Postgres server (a CI service container, local Docker), with the schema or migrations applied; `drop()` removes it. No container per test file.
- `rolledBack(db, fn)` — runs a test in a transaction that's always rolled back; code holding only the client joins it through the call chain.
