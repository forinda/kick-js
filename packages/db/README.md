# @forinda/kickjs-db

> KickJS-native ORM — code-first schema, reversible migrations, multi-dialect SQL.

Phantom-typed column builders, `SchemaToTypes<S>` for end-to-end row inference, `KickDbRegister` module augmentation, runtime lifecycle hooks (`query` / `queryError` / `slowQuery`), `customType` mapper, `pgEnum` with full migration pipeline, and `db.$extends({ model })` per-table methods.

## Install

```bash
pnpm add @forinda/kickjs-db pg          # PostgreSQL — dialect ships as the /pg subpath
```

## Quick start

```ts
import { table, uuid, varchar, timestamp, createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import { Pool } from 'pg'

// 1. Schema — phantom T flows through every column automatically.
const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})

const schema = { users }
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// 2. Client — DB shape inferred from schema, no manual generic.
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
  slowQueryThresholdMs: 100,
})

db.on('slowQuery', ({ sql, durationMs }) => {
  console.warn({ sql, durationMs }, 'slow query')
})

// 3. Query — fully typed against the schema.
const row = await db
  .selectFrom('users')
  .selectAll()
  .where('email', '=', 'a@b.com')
  .executeTakeFirst()
//  row?.email is string; row?.createdAt is Date
```

## Docs

- [Schema Types](https://kickjs.app/guide/db-schema-types) — phantom inference, `KickDbRegister`, self-references, `pgEnum`
- [DB Extensions](https://kickjs.app/guide/db-extensions) — `customType<T>()`, `$extends({ model })`
- [Type Generation](https://kickjs.app/guide/typegen) — `kick typegen` plugin contract + `kick/db` auto-emit

## Dialect subpaths

Each dialect ships inside this package — no extra install beyond the driver:

- `@forinda/kickjs-db/pg` — PostgreSQL (`pgDialect`, `pgAdapter`); peer driver `pg`
- `@forinda/kickjs-db/mysql` — MySQL (`mysqlDialect`, `mysqlAdapter`); peer driver `mysql2`
- `@forinda/kickjs-db/sqlite` — SQLite (`sqliteDialect`, `sqliteAdapter`); peer driver `better-sqlite3`

> The standalone `@forinda/kickjs-db-pg` / `-db-mysql` / `-db-sqlite` packages are deprecated re-export shims kept for one release; import from the subpaths above instead.

## Companion packages

- [`@forinda/kickjs`](https://www.npmjs.com/package/@forinda/kickjs) — framework runtime + DI container
- [`@forinda/kickjs-cli`](https://www.npmjs.com/package/@forinda/kickjs-cli) — `kick db generate`, `kick db migrate`, `kick typegen`

## License

MIT © Felix Orinda
