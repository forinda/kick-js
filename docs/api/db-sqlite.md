# @forinda/kickjs-db-sqlite

SQLite peer adapter for [`@forinda/kickjs-db`](./db.md). Built on `better-sqlite3` (synchronous, in-process — perfect for tests + small embedded apps).

## Installation

```bash
pnpm add @forinda/kickjs-db-sqlite better-sqlite3
```

Peer of `@forinda/kickjs-db@workspace:^`.

## Quick Start

```ts
import Database from 'better-sqlite3'
import { bootstrap } from '@forinda/kickjs'
import { kickDbAdapter } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db-sqlite'

const sqlite = new Database('./app.db')

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      schema,
      adapter: sqliteAdapter({ database: sqlite }),
      migrationsOnBoot: 'fail-if-pending',
    }),
  ],
})
```

## `sqliteAdapter(options)`

Implements both `MigrationAdapter` and the query-dialect surface. Pass to `kickDbAdapter({ adapter: ... })`.

### `SqliteAdapterOptions`

| Option     | Type       | Description                                                                      |
| ---------- | ---------- | -------------------------------------------------------------------------------- |
| `database` | `Database` | A `better-sqlite3` instance — `new Database(path)` or `new Database(':memory:')` |

In-memory mode is ideal for tests:

```ts
import { createTestDb } from '@forinda/kickjs-testing'
const db = await createTestDb({ schema, dialect: 'sqlite' })
```

### Type-only exports

- `SqliteDatabaseLike` — minimal shape `sqliteAdapter` accepts.
- `SqliteStatement` — prepared-statement shape.

Use these to stub `better-sqlite3` in pure unit tests without loading the native module.

## `sqliteDialect(options)`

Standalone dialect — use when wiring `createDbClient()` directly:

```ts
import Database from 'better-sqlite3'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db-sqlite'

const sqlite = new Database(':memory:')
const db = createDbClient({ schema, dialect: sqliteDialect({ database: sqlite }) })
```

### `SqliteDialectOptions`

| Option     | Type       | Description                   |
| ---------- | ---------- | ----------------------------- |
| `database` | `Database` | The `better-sqlite3` instance |

## Dialect capabilities

| Capability                                         | SQLite support                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Transactions                                       | ✅ (via `better-sqlite3.transaction()`)                                                                                                |
| Savepoints                                         | ✅                                                                                                                                     |
| Streaming via cursor                               | ❌ — `better-sqlite3` is synchronous; iterate `.all()` results in JS instead                                                           |
| AbortSignal mid-flight cancellation                | ❌ — synchronous driver. Already-aborted signals short-circuit before the call; once a statement is running it completes synchronously |
| `pgEnum`                                           | ❌ — SQLite has no native ENUM type; emulate via CHECK constraint                                                                      |
| Relational query (`db.query.X.findMany({ with })`) | ✅ via `json_group_array(json_object(...))`                                                                                            |

### SQLite quirks worth knowing

- **Foreign keys are off by default in SQLite.** Enable per-connection with `PRAGMA foreign_keys = ON`. The `sqliteAdapter` does NOT issue this PRAGMA automatically — invoke it once per process if your schema relies on FK behaviour.
- **`ALTER TYPE` doesn't exist.** Type changes go through `ALTER TABLE … RENAME` + a fresh CREATE TABLE + `INSERT INTO … SELECT`; the diff engine emits this pattern when needed.
- **JSON columns come back as TEXT** — the kickjs-db client installs `ParseJSONResultsPlugin` so `jsonb<T>()` columns deserialize automatically.

## Exports

`sqliteAdapter`, `sqliteDialect`. Type-only: `SqliteAdapterOptions`, `SqliteDialectOptions`, `SqliteDatabaseLike`, `SqliteStatement`.
