# @forinda/kickjs-db-sqlite

> better-sqlite3 adapter for `@forinda/kickjs-db` — `MigrationAdapter` + Kysely `SqliteDialect`.

Ships the bridge between `@forinda/kickjs-db`'s migration runner / relational query layer and an in-process SQLite database via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (or any structurally compatible handle, e.g. `bun:sqlite`).

## Install

```bash
pnpm add @forinda/kickjs-db @forinda/kickjs-db-sqlite better-sqlite3
```

## Quick start

```ts
import Database from 'better-sqlite3'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db-sqlite'

const database = new Database('app.db')

export const db = createDbClient({
  schema, // your declared schema
  dialect: sqliteDialect({ database }),
})

export const migrationAdapter = sqliteAdapter({ database })
```

`createDbClient` auto-attaches Kysely's `ParseJSONResultsPlugin` for the SQLite dialect — `db.query.X.findMany({ with })` round-trips nested rows as parsed JS objects rather than JSON-encoded TEXT.

## What ships

- **`sqliteDialect({ database })`** — wraps Kysely's `SqliteDialect`.
- **`sqliteAdapter({ database })`** — implements `MigrationAdapter` for `@forinda/kickjs-db`'s migration runner (`kick db migrate` + `kickDbAdapter` boot-time apply). Handles `kick_migrations` / `kick_migrations_lock` table creation, lock acquisition, applying SQL in / out of a transaction.
- **Drift detection (`introspect()`) is not yet implemented in v1** — it throws `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Set `driftCheck: 'off'` on the migration runner until a follow-up adds the `sqlite_master` + `pragma` walk.

## License

MIT © Felix Orinda
