# Database

`@forinda/kickjs-db` is the first-party database layer for KickJS — a code-first ORM built on [Kysely](https://kysely.dev). You declare your schema in TypeScript, get typed queries with no codegen step, and ship reversible migrations through the `kick db` CLI.

This page is one continuous path: install → schema → migration → query, with nothing assumed between the steps. It uses **SQLite** so you can finish it without provisioning anything; the only lines that change for Postgres or MySQL are called out at the end.

The deeper references — every column type, the relational query layer, the full migration command set — are linked from [Where to go next](#where-to-go-next).

## What you get

- **Code-first schema** — `table()`, typed column builders (`uuid()`, `varchar()`, `timestamp()`, …), enums, foreign keys, indexes, and `relations()`. One declaration drives both the SQL and the TypeScript types.
- **Typed client** — `createDbClient({ schema, dialect })` returns a client whose `selectFrom` / `insertInto` / `updateTable` / `deleteFrom` are typed from your schema. No hand-written `interface DB`.
- **Relational queries** — `db.query.users.findMany({ with: { posts: true } })` compiles to one JSON-aggregated query, not N+1.
- **Reversible migrations** — `kick db generate` diffs the schema and writes `up.sql` + `down.sql` + a snapshot; `kick db migrate latest` applies them with a lock table, batch tracking and drift detection.
- **Lifecycle adapter** — `kickDbAdapter()` decides what happens to pending migrations on boot and drains the pool on shutdown.

## 1. Install

`kick add` installs the core package and the driver for your dialect together:

<PmCommand exec="kick add sqlite" />

| Dialect         | `kick add` | Packages installed                      |
| --------------- | ---------- | --------------------------------------- |
| SQLite          | `sqlite`   | `@forinda/kickjs-db` + `better-sqlite3` |
| PostgreSQL      | `pg`       | `@forinda/kickjs-db` + `pg`             |
| MySQL / MariaDB | `mysql`    | `@forinda/kickjs-db` + `mysql2`         |

Everything ships from the one package — the dialects are subpath exports (`@forinda/kickjs-db/sqlite`), not separate installs.

## 2. Mount the db CLI

::: warning Do this before reaching for `kick db`
The `kick db` command tree ships inside `@forinda/kickjs-db`, not the base CLI, and is **opt-in**. Until you mount it, `kick db generate` is not a command — this is the most common "why doesn't this work" in the setup.
:::

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin], // ← adds the `kick db` commands
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'sqlite',
  },
})
```

Check it took:

```bash
kick db --help
```

The `db` block is read by both the CLI and the migration tooling, so it is configured once:

| Field              | Default              | Purpose                                                          |
| ------------------ | -------------------- | ---------------------------------------------------------------- |
| `schemaPath`       | `'src/db/schema.ts'` | Module exporting your `table()` declarations                     |
| `migrationsDir`    | `'db/migrations'`    | Where `kick db generate` writes migrations                       |
| `dialect`          | `'postgres'`         | `'postgres' \| 'sqlite' \| 'mysql'`                              |
| `connectionString` | `$DATABASE_URL`      | Used by the built-in Postgres adapter                            |
| `adapter`          | —                    | Factory returning a custom `MigrationAdapter` (see [CLI](./cli)) |

If you would rather not mount a plugin, the same commands ship as a standalone `kickjs-db` binary — see [Database CLI](./cli).

## 3. Declare the schema

A schema is a plain module of `table()` declarations:

```ts
// src/db/schema.ts
import { table, uuid, varchar, timestamp } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  createdAt: timestamp().notNull().defaultNow(),
})
```

Each column's type flows through to the client: `name` is `string | null` because it has no `.notNull()`, and `createdAt` is a generated `Date` you never pass on insert. Every builder is in [Schema](./schema).

## 4. Generate and apply the first migration

```bash
kick db generate init
```

That diffs the schema against the last snapshot — there isn't one yet, so everything is new — and writes a migration directory containing `up.sql`, `down.sql`, a snapshot, and `meta.json`. **Read the SQL before applying it.** Generation is a diff, not an oracle; the review gate exists because a rename and a drop+add look identical to a differ.

```bash
kick db migrate status    # what's pending
kick db migrate latest    # apply
```

Later changes are the same two commands: edit the schema, `kick db generate <name>`, read the SQL, `kick db migrate latest`. [Migrations](./migrations) covers rollback, batches, drift detection and the review gate.

## 5. Create the client

```ts
// src/db/client.ts
import Database from 'better-sqlite3'
import { createDbClient } from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from './schema'

const database = new Database('dev.db')

export const db = createDbClient({
  schema,
  dialect: sqliteDialect({ database }),
})

// The same handle feeds the migration adapter — one connection, not two.
export const migrationAdapter = sqliteAdapter({ database })
```

`createDbClient` infers the database shape from `schema`, so there is no generic to pass and nothing to regenerate when the schema changes.

## 6. Make it injectable

The client is a value you own — register it under **your own token**:

```ts
// src/db/token.ts
import { createToken } from '@forinda/kickjs'
import type { db } from './client'

export const APP_DB = createToken<typeof db>('app/db')
```

```ts
// src/modules/db.module.ts
import { defineModule } from '@forinda/kickjs'
import { APP_DB } from '../db/token'
import { db } from '../db/client'

export const DbModule = defineModule({
  name: 'DbModule',
  build: () => ({
    register(container) {
      container.registerFactory(APP_DB, () => db)
    },
  }),
})
```

Typing the token with `typeof db` means `@Inject(APP_DB)` hands back your exact schema — no augmentation needed.

::: tip The shipped tokens are a shortcut, not a requirement
`@forinda/kickjs-db` also exports `DB_PRIMARY`, `DB_REPLICA` and `DB_CLIENT`. Nothing in the framework resolves them — the db adapter registers only what you hand it — so they are pre-made tokens for the common primary/replica shape, not an interface you have to adopt.

Use them if that shape fits. Define your own when it doesn't: sharding, per-tenant clients, an analytics connection, or simply a name that reads better in your codebase. The `kick/` prefix is reserved for first-party tokens, so name yours under your own scope (`app/db/tenants`).
:::

## 7. Query

```ts
import { Service, Inject } from '@forinda/kickjs'
import { APP_DB } from '../db/token'
import type { db } from '../db/client'

@Service()
export class UsersService {
  @Inject(APP_DB) private db!: typeof db

  create(email: string, name: string) {
    return this.db
      .insertInto('users')
      .values({ email, name }) // id and createdAt are generated — omit them
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  findByEmail(email: string) {
    return this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }
}
```

`row.email` is `string`, `row.createdAt` is `Date`, and a typo in a column name is a compile error. [Queries](./queries) covers filtering, the relational `db.query` layer, transactions and pagination.

## 8. Decide what happens on boot

`kickDbAdapter()` checks for pending migrations at startup and closes the connection on shutdown:

```ts
// src/index.ts
export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
})
```

- `'fail-if-pending'` (default) — refuse to boot with migrations pending, so a deploy never silently mutates the schema.
- `'apply'` — run them. Convenient in dev and preview environments.
- `'ignore'` — boot regardless.

## Using Postgres or MySQL instead

Only three things differ from the SQLite path above:

| Step             | SQLite                        | PostgreSQL                          |
| ---------------- | ----------------------------- | ----------------------------------- |
| install (step 1) | `kick add sqlite`             | `kick add pg`                       |
| `db.dialect`     | `'sqlite'`                    | `'postgres'` (+ `connectionString`) |
| client (step 5)  | `sqliteDialect({ database })` | `pgDialect({ pool })`               |

```ts
import { Pool } from 'pg'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
export const migrationAdapter = pgAdapter({ pool })
```

Schema, migrations, queries and DI are identical. [Drivers](./drivers) covers the capability differences that do exist — enum support, returning clauses, and what each dialect does with `defaultRandom()`.

## Where to go next

In rough reading order:

- [Schema](./schema) — tables, columns, enums, foreign keys, indexes, relations, custom types.
- [Schema Types](../db-schema-types) — how the inference works, and the `kick db typegen` route to a typed `KickDbClient` everywhere.
- [Queries](./queries) — the query builder, transactions, lifecycle events, pagination.
- [Relational Queries](../db-relational-query) — `db.query.<table>.findMany({ with })` in depth.
- [Migrations](./migrations) — the review gate, batches, rollback, drift detection.
- [Database CLI](./cli) — every `kick db` command, plus the standalone binary.
- [Drivers](./drivers) — per-dialect connection config and capabilities.
- [Repositories](./repositories) — putting the client behind a repository interface.
- [Extensions](../db-extensions) — custom column types and dialect-level extensions.
