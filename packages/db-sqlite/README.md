# @forinda/kickjs-db-sqlite

> SQLite adapter for [`@forinda/kickjs-db`](https://www.npmjs.com/package/@forinda/kickjs-db).

Two factories:

- **`sqliteDialect({ database })`** — query-layer dialect for `createDbClient({ dialect })`.
- **`sqliteAdapter({ database })`** — `MigrationAdapter` for `kick db migrate` + `kickDbAdapter` boot-time apply.

Both consume a [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) handle (or any structurally compatible runtime, e.g. `bun:sqlite`).

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

`db.query.X.findMany({ with })` round-trips nested rows as parsed JS objects: SQLite's JSON aggregation returns TEXT, but `createDbClient` transparently parses it on the way back so adopters never see the encoded form.

## Notes

- **Drift detection (`introspect()`) is not yet implemented in v1** — it throws `KickDbError` with code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Set `driftCheck: 'off'` on the migration runner until a follow-up adds the `sqlite_master` + `pragma` walk.

## License

MIT © Felix Orinda
