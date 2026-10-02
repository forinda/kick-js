---
description: Set up kick/db on PostgreSQL — install, connection string, schema with enums and timestamptz, migrations, the typed client in DI, and what Postgres does differently.
---

# Get Started with PostgreSQL

The same path as [Getting started](./index.md), on PostgreSQL: install, schema, migration, query. Postgres is kick/db's most complete dialect — enums, `timestamptz`, named schemas, `RETURNING` and full introspection all work — and the one the CLI connects to with no extra configuration.

## 1. Start a database

Any Postgres 13 or newer works. For a local one:

```bash
docker run -d --name app-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app postgres:18-alpine
```

## 2. Install

<PmCommand exec="kick add pg" />

This installs `@forinda/kickjs-db`, the `pg` driver and `@types/pg`.

## 3. The connection string

Put the URL in `.env`:

```bash
# .env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
```

and declare it in the env schema, so the app refuses to start without one:

```ts
// src/config/index.ts
const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.url(),
  }),
)
```

`.env.test` is read _instead of_ `.env` under vitest, so give it a `DATABASE_URL` too — ideally a separate test database.

## 4. Mount the db CLI

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'
import { dbCliPlugin } from '@forinda/kickjs-db/cli'

export default defineConfig({
  plugins: [dbCliPlugin],
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres',
    // connectionString defaults to process.env.DATABASE_URL
  },
})
```

That's all the CLI needs: on Postgres it builds its own connection from `DATABASE_URL`, which `kick` reads from `.env`. Other dialects need an `adapter` factory here.

## 5. Declare the schema

```ts
// src/db/schema.ts
import { relations, table, text, timestamptz, uuid, varchar } from '@forinda/kickjs-db'
import { pgEnum } from '@forinda/kickjs-db/pg'

export const role = pgEnum('role', 'admin', 'member')

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  role: role().notNull().default('member'),
  createdAt: timestamptz().notNull().defaultNow(),
})

export const posts = table('posts', {
  id: uuid().primaryKey().defaultRandom(),
  authorId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar(200).notNull(),
  body: text(),
  createdAt: timestamptz().notNull().defaultNow(),
})

export const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
export const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

`role` is typed `'admin' | 'member'` everywhere the client touches it. [Schema](./schema.md) lists every builder; `@forinda/kickjs-db/pg` holds the Postgres-only ones (`pgEnum`, `citext`, `inet`, `tsvector`, `vector(n)`, …).

## 6. Generate, review, apply

<PmCommand exec="kick db generate init" />

```sql
CREATE TYPE "role" AS ENUM ('admin', 'member');
CREATE TABLE "posts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "authorId" uuid NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL,
  "name" varchar(120),
  "role" role NOT NULL DEFAULT 'member',
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
```

The enum becomes a real Postgres type, created before the tables that use it. Read the SQL, mark it reviewed — `<id>` is the folder name `generate` printed — and apply:

<PmCommand exec="kick db migrate review <id>" />

<PmCommand exec="kick db migrate latest" />

Postgres runs DDL inside transactions, so each migration applies completely or not at all. [Migrations](./migrations.md) covers status, rollback and drift detection.

## 7. The client, in DI

```ts
// src/db/client.ts
import { Pool } from 'pg'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import { env } from '../config'
import * as schema from './schema'

const pool = new Pool({ connectionString: env.DATABASE_URL })

export const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

// The same pool runs migrations.
export const migrationAdapter = pgAdapter({ pool })
```

One pool serves both the queries and the boot-time migration check. `pgDialect` and `pgAdapter` accept any pg-compatible pool — Neon's serverless `Pool` included ([Drivers](./drivers.md)).

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

A repository built on the client, registered with `createUserRepository(container.resolve(APP_DB))`:

```ts
// src/modules/users/user.repository.ts
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

    async create(dto: CreateUserDTO) {
      return db.insertInto('users').values(dto).returningAll().executeTakeFirstOrThrow()
    },

    async update(id: string, dto: UpdateUserDTO) {
      const row = await db
        .updateTable('users')
        .set(dto)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()
      if (!row) throw HttpException.notFound('User not found')
      return row
    },
  }
}
```

```bash
curl -s -X POST localhost:3000/api/v1/users \
  -H 'content-type: application/json' -d '{"email":"grace@example.com","name":"Grace"}'
# {"id":"3a1f80e4-…","email":"grace@example.com","name":"Grace","role":"member",
#  "createdAt":"2026-10-02T16:51:27.038Z"}
```

`returningAll()` hands back the row the database wrote — defaults included — in the same round trip. A second insert with the same email answers `409`: the unique index raises `UniqueViolationError`, which carries the status ([Errors](./errors.md)). [Relational Queries](../db-relational-query.md) covers `with` in depth.

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

## Postgres notes

- **UUIDs.** `uuid().defaultRandom()` is `gen_random_uuid()`, built into Postgres 13+ — no extension needed.
- **`timestamptz` or `timestamp`.** Both read back as `Date`. `timestamptz` stores an absolute instant; `timestamp` stores a wall-clock time with no zone, which the driver interprets in the Node process's zone. Prefer `timestamptz` unless you mean a local time.
- **Enums.** `pgEnum` emits `CREATE TYPE … AS ENUM`, and the column's TypeScript type is the union of its values. Put a value list that changes often in a `varchar` with a `check()` instead — [Keys & Constraints](./constraints.md).
- **Named schemas.** `pgSchema('billing').table(...)`, from `@forinda/kickjs-db/pg`, puts a table in a schema other than `public` — see [Table Forms](../db-table-forms.md).
- **Tests.** The [Database Testing](./testing.md) guide covers running each test in a transaction that rolls back, so a shared Postgres stays clean.

## Next

- [Schema](./schema.md) and [Keys & Constraints](./constraints.md)
- [Queries](./queries.md), [Relational Queries](../db-relational-query.md), [Transactions](./transactions.md)
- [Migrations](./migrations.md) and [Drivers](./drivers.md)
- The SQLite version of this page: [Getting started](./index.md)
