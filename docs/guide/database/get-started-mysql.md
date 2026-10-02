---
description: Set up kick/db on MySQL or MariaDB — install, the migration adapter factory, schema, migrations, the typed client in DI, and what MySQL does differently (no RETURNING, UTC, DDL that commits).
---

# Get Started with MySQL

The same path as [Getting started](./index.md), on MySQL 8.0+ or MariaDB 10.5+: install, schema, migration, query. MySQL needs a little more wiring than Postgres — a migration adapter factory, a time zone setting — and it has no `RETURNING`, which changes how you write inserts. Each difference is called out where it comes up.

## 1. Start a database

```bash
docker run -d --name app-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=mysql -e MYSQL_DATABASE=app mysql:8
```

MySQL 8 creates databases in `utf8mb4` by default, so text columns hold any Unicode, emoji included. The floor is MySQL 8.0 / MariaDB 10.5: relational queries compile to `JSON_ARRAYAGG`, and the adapter checks the server version on first connection.

## 2. Install

<PmCommand exec="kick add mysql" />

This installs `@forinda/kickjs-db` and the `mysql2` driver, which ships its own types.

## 3. The connection string

```bash
# .env
DATABASE_URL=mysql://root:mysql@localhost:3306/app
```

```ts
// src/config/index.ts — in the env schema
DATABASE_URL: z.url(),
```

Give `.env.test` a `DATABASE_URL` too — it's read _instead of_ `.env` under vitest.

## 4. Mount the db CLI

The CLI connects to Postgres on its own; for MySQL, hand it an `adapter` factory:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin],
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'mysql',
    adapter: async () => {
      const { createPool } = await import('mysql2/promise')
      const { mysqlAdapter } = await import('@forinda/kickjs-db/mysql')
      const pool = createPool({ uri: process.env.DATABASE_URL!, timezone: 'Z' })
      // This pool belongs to the CLI run, so the adapter ends it when the command finishes.
      return mysqlAdapter({ pool, endPoolOnClose: true })
    },
  },
})
```

`endPoolOnClose: true` matters here. By default `mysqlAdapter` leaves the pool open, because an app shares one pool with its query client; the CLI's pool has no other owner, and an open pool would keep `kick db` from exiting.

`timezone: 'Z'` is explained in [step 7](#_7-the-client-in-di).

## 5. Declare the schema

```ts
// src/db/schema.ts
import { index, relations, table, text, timestamp, uuid, varchar } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  role: varchar(20).notNull().default('member'),
  createdAt: timestamp().notNull().defaultNow(),
})

export const posts = table(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
    body: text(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  // MySQL indexes every foreign key column; declaring the index keeps it in your schema.
  (t) => ({ authorIdx: index('posts_author_idx').on(t.authorId) }),
)

export const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
export const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

**Index foreign key columns.** InnoDB needs an index on a foreign key's columns and creates one itself if you don't; kick/db's drift check knows that index and ignores it. Declaring it yourself, as `posts_author_idx` above, gives it a name you chose — and it's what makes the `ON DELETE CASCADE` and the join behind `with: { posts: true }` fast.

Postgres-only builders (`pgEnum`, `citext`, …) aren't available; use a `varchar` with a `check()` for a fixed set of values ([Keys & Constraints](./constraints.md)).

## 6. Generate, review, apply

<PmCommand exec="kick db generate init" />

```sql
CREATE TABLE `posts` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `authorId` CHAR(36) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);
CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  …
);
CREATE INDEX `posts_author_idx` ON `posts` (`authorId`);
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_fk` FOREIGN KEY (`authorId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
```

A `uuid()` is a `CHAR(36)`, and `defaultRandom()` becomes MySQL's `UUID()` — a version-1 UUID. Mark the migration reviewed — `<id>` is the folder name `generate` printed — and apply:

<PmCommand exec="kick db migrate review <id>" />

<PmCommand exec="kick db migrate latest" />

::: warning A failed migration can be half applied
MySQL commits each DDL statement as it runs, so the transaction around a migration can't undo statements that already succeeded. If the second statement fails, the first stays applied, and the migration stays pending, so running it again fails on what's already there. For example, adding a column and then a unique index on it fails at the index when existing rows share a value, and the new column stays behind.

To recover, undo by hand what did apply (drop the column), fix the schema, delete the failed migration folder and its entry in `db/migrations/_journal.json`, and generate it again. Small migrations, one change each, keep this rare and easy to untangle.
:::

## 7. The client, in DI

```ts
// src/db/client.ts
import { createPool } from 'mysql2/promise'
import { createDbClient } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'
import { env } from '../config'
import * as schema from './schema'

// timezone 'Z': read and write DATETIME / TIMESTAMP as UTC, not the host's zone.
const pool = createPool({ uri: env.DATABASE_URL, timezone: 'Z' })

// One pool for queries and migrations.
export const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
export const migrationAdapter = mysqlAdapter({ pool })
```

- **`timezone: 'Z'`.** `mysql2` reads and writes `DATETIME` / `TIMESTAMP` values in the Node process's time zone by default. On a server whose zone isn't UTC, every date shifts by the offset — a row created at 16:52 UTC reads back as 13:52 on a UTC+3 machine. With `'Z'`, values are UTC both ways, matching what `CURRENT_TIMESTAMP` writes on a UTC database.
- **Dates in nested rows** — the ones `db.query … with` returns — are read in the same `timezone`, so they match the same column read directly.

The token and module are the same as on any dialect:

```ts
// src/db/token.ts
import { createToken } from '@forinda/kickjs'
import type { db } from './client'

export const APP_DB = createToken<typeof db>('app/Db')
```

```ts
// src/db/db.module.ts
import { defineModule } from '@forinda/kickjs'
import { APP_DB } from './token'
import { db } from './client'

export const DbModule = defineModule({
  name: 'DbModule',
  build: () => ({
    register(container) {
      container.registerFactory(APP_DB, () => db)
    },
    // No HTTP surface — this module only registers the client.
    routes: () => null,
  }),
})
```

Mount `DbModule()` first in `src/modules/index.ts`, before the modules that inject `APP_DB`.

## 8. Query

MySQL has no `RETURNING`. `returningAll()` type-checks but fails at run time with a syntax error, so an insert can't hand back the row it wrote. Choose the id in the app, insert, then read the row:

```ts
// src/modules/users/user.repository.ts
import { randomUUID } from 'node:crypto'

export function createUserRepository(db: typeof Db) {
  return {
    /** A user with their posts, in one query. */
    async findById(id: string) {
      return (
        (await db.query.users.findFirst({
          where: (u, eb) => eb('id', '=', id),
          with: { posts: true },
        })) ?? null
      )
    },

    // MySQL has no RETURNING: choose the id here, insert, then read the row back.
    async create(dto: CreateUserDTO) {
      const id = randomUUID()
      await db
        .insertInto('users')
        .values({ id, ...dto })
        .execute()
      return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    },

    async update(id: string, dto: UpdateUserDTO) {
      const { numUpdatedRows } = await db
        .updateTable('users')
        .set(dto)
        .where('id', '=', id)
        .executeTakeFirst()
      if (numUpdatedRows === 0n) throw HttpException.notFound('User not found')
      return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    },
  }
}
```

Choosing the id in the app also makes it a version-4 UUID rather than `UUID()`'s version 1. An `INSERT` into a table with an auto-increment key reports the new id as `insertId` on the result instead.

```bash
curl -s -X POST localhost:3000/api/v1/users \
  -H 'content-type: application/json' -d '{"email":"grace@example.com","name":"Grace"}'
# {"id":"f23fe7d3-…","email":"grace@example.com","name":"Grace","role":"member",
#  "createdAt":"2026-10-02T17:00:39.000Z"}
```

`TIMESTAMP` keeps whole seconds unless you declare a precision. A second insert with the same email answers `409`: the unique index raises `UniqueViolationError` ([Errors](./errors.md)). [Relational Queries](../db-relational-query.md) covers `with` in depth.

## 9. Decide what happens on boot

```ts
// src/index.ts
import { kickDbAdapter } from '@forinda/kickjs-db'
import { migrationAdapter } from './db/client'

export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  adapters: [
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
})
```

In development pending migrations apply on boot; anywhere else the app refuses to start until `kick db migrate latest` has run.

## MySQL notes, in one place

- **No `RETURNING`** — insert, then select; pick ids in the app.
- **`timezone: 'Z'`** on every pool, the CLI's included.
- **Index foreign key columns** you join on; InnoDB adds an index anyway if you don't.
- **DDL commits as it runs** — keep migrations small; a failure can leave part of one applied.
- **`uuid()` is `CHAR(36)`**; `defaultRandom()` is `UUID()` (version 1).
- **MySQL 8.0 / MariaDB 10.5** or newer.

## Next

- [Schema](./schema.md) and [Keys & Constraints](./constraints.md)
- [Queries](./queries.md), [Relational Queries](../db-relational-query.md), [Transactions](./transactions.md)
- [Migrations](./migrations.md) and [Drivers](./drivers.md)
- The SQLite version of this page: [Getting started](./index.md)
