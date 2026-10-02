---
'@forinda/kickjs-db': minor
---

Migrations written in TypeScript. `kick db generate <name> --ts` (or `generate({ typescript: true })`) writes a `migration.ts` exporting `up(db)` / `down(db)`, for data changes that need code.

- **Runs:** `db` is Kysely on the migration's transaction, and the migration is recorded on the same transaction, so a failure leaves neither its changes nor its record. With `"transaction": false` it runs on the connection.
- **Hashing:** the code is hashed with the migration, so an edit after review is refused. SQL migrations keep their existing hashes.
- **Adapters:** migration adapters gain an optional `kysely()`, which the Postgres, MySQL and SQLite adapters implement.
- **Loading:** migration code is read fresh on every run, never from a module cache.
