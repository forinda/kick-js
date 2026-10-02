---
description: Coming to kick/db from Prisma — how schema.prisma, migrate, the generated client, include, transactions and P-codes map onto a TypeScript schema, reviewed migrations and a typed query builder.
---

# Coming from Prisma

Prisma and kick/db agree on the big idea: one schema is the source of truth, migrations are generated from it, and every query is checked against it. They differ in where that schema lives and what you query with. Prisma has its own schema language and a client generated from it; kick/db's schema is ordinary TypeScript, and the client's types are inferred from it — there is no generate step. Queries go through a SQL-shaped builder ([Kysely](https://kysely.dev)) rather than nested objects, with a Prisma-like relational API for reads that load related rows.

The examples use Postgres. Everything kick/db shown here runs as written.

## The schema

```prisma
// schema.prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique @db.VarChar(255)
  name      String?  @db.VarChar(120)
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        String   @id @default(uuid())
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  title     String   @db.VarChar(200)
  slug      String   @db.VarChar(200)
  published Boolean  @default(false)
  views     Int      @default(0)
  createdAt DateTime @default(now())

  @@unique([authorId, slug])
  @@index([authorId])
}
```

```ts
// src/db/schema.ts
import {
  boolean,
  index,
  integer,
  relations,
  table,
  timestamp,
  unique,
  uuid,
  varchar,
} from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
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
    slug: varchar(200).notNull(),
    published: boolean().notNull().default('false'),
    views: integer().notNull().default('0'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    authorIdx: index('posts_author_idx').on(t.authorId),
    slugUnique: unique('posts_author_slug_unique').on(t.authorId, t.slug),
  }),
)

export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

| Prisma                                    | kick/db                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `model User { … }`                        | `export const users = table('users', { … })` — or a [class form](../db-table-forms.md)       |
| Model name ≠ table name, `@@map`          | the first argument _is_ the table name                                                       |
| `@map("created_at")`                      | no mapping: the key is the column name. Name the key `created_at`, or keep camelCase columns |
| `String?` (optional)                      | nullable by default; `.notNull()` makes it required                                          |
| `@id @default(uuid())`                    | `uuid().primaryKey().defaultRandom()`                                                        |
| `@id @default(autoincrement())`           | `serial().primaryKey()` (`bigSerial()` for `BigInt`)                                         |
| `@default(now())`                         | `.defaultNow()`                                                                              |
| `@updatedAt`                              | no equivalent yet — set `updatedAt: new Date()` in the update                                |
| `@unique`, `@@unique([a, b])`             | `.unique()`, `unique(name).on(t.a, t.b)` in the third argument                               |
| `@@index([a])`                            | `index(name).on(t.a)`                                                                        |
| `@@id([a, b])`                            | `primaryKey().on(t.a, t.b)` ([Keys & Constraints](./constraints.md))                         |
| `@relation(fields, references, onDelete)` | `.references(() => users.id, { onDelete: 'cascade' })` on the column                         |
| relation fields (`posts Post[]`)          | `relations()`, declared beside the tables; used by `db.query` only, no DDL                   |
| `enum Role { … }`                         | `pgEnum('role', 'admin', 'member')` from `@forinda/kickjs-db/pg`                             |
| `Json`, `Decimal`, `Bytes`                | `json<T>()` / `jsonb<T>()`, `decimal(p, s)` (a `string`), `bytea()`                          |
| `Unsupported("…")`, a custom scalar       | `customType<T>({ dataType, toDriver, fromDriver })` ([Extensions](../db-extensions.md))      |
| CHECK constraint (raw SQL in a migration) | `check(name, sql)` — part of the schema, so migrations generate it                           |

Every column type is on [Tables & Columns](./schema.md).

## Migrations

| Prisma                                 | kick/db                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `prisma migrate dev --name add_posts`  | `kick db generate add_posts` — writes the SQL; nothing runs yet                  |
| (edit `migration.sql` before applying) | read `up.sql`, then `kick db migrate review <id>` — required outside development |
| `prisma migrate deploy`                | `kick db migrate latest`                                                         |
| `prisma migrate status`                | `kick db migrate status`                                                         |
| no down migrations                     | every migration has a `down.sql`; `kick db migrate down` / `rollback` reverse it |
| `prisma migrate dev --create-only`     | `kick db generate <name> --empty` for hand-written SQL                           |
| `prisma db pull`                       | `kick db introspect`                                                             |
| `prisma migrate resolve --applied`     | baseline an existing database — see [Adopting](./adopting.md)                    |
| `prisma db push`                       | no equivalent: every change is a migration                                       |
| `prisma generate`                      | nothing to run — types are inferred from `schema.ts` on save                     |
| `_prisma_migrations`                   | `kick_migrations` + `kick_migrations_lock`                                       |

Two things Prisma doesn't do: the runner refuses a migration nobody marked reviewed (outside `NODE_ENV=development`), and before applying it checks the live database still matches the last snapshot — a hand-made change is reported as drift. [Migrations](./migrations.md) covers both.

## Queries

`db` below is the client from `createDbClient({ schema, dialect })`. In a KickJS app you inject it by token ([Getting started](./index.md)).

| Prisma                                          | kick/db                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `findMany({ where, orderBy, take, skip })`      | `selectFrom(t).selectAll().where(…).orderBy(…).limit(n).offset(n).execute()`                                      |
| `findUnique({ where: { email } })`              | `….where('email', '=', email).executeTakeFirst()` → row or `undefined`                                            |
| `findUniqueOrThrow`                             | `….executeTakeFirstOrThrow()`                                                                                     |
| `select: { id: true, title: true }`             | `.select(['id', 'title'])`                                                                                        |
| `include: { posts: true }`                      | `db.query.users.findMany({ with: { posts: true } })` — one query                                                  |
| `equals`, `not`, `in`, `notIn`                  | `'='`, `'<>'`, `'in'`, `'not in'`                                                                                 |
| `lt`, `lte`, `gt`, `gte`                        | `'<'`, `'<='`, `'>'`, `'>='`                                                                                      |
| `contains`, `startsWith`, `mode: 'insensitive'` | `'like'` / `'ilike'` with `%` — escape user input with `escapeLike` ([Raw SQL](./raw-sql.md#searching-with-like)) |
| `OR: [...]`, `AND`, `NOT`                       | `where((eb) => eb.or([...]))`, `eb.and`, `eb.not`                                                                 |
| relation filters `some` / `none`                | `eb.exists(…)` subqueries ([recipes](./raw-sql.md#count-exists-group-by))                                         |
| `create({ data })`                              | `insertInto(t).values({…}).returningAll().executeTakeFirstOrThrow()`                                              |
| nested `create` / `connect`                     | separate inserts inside one `transaction()`                                                                       |
| `update`, `updateMany`                          | `updateTable(t).set({…}).where(…)` — one form for both                                                            |
| `delete`, `deleteMany`                          | `deleteFrom(t).where(…)`                                                                                          |
| `increment: 1`                                  | `.set((eb) => ({ views: eb('views', '+', 1) }))`                                                                  |
| `upsert`                                        | `insertInto(…).onConflict(…)` ([recipe](./raw-sql.md#upsert))                                                     |
| `count`, `aggregate`, `groupBy`                 | `eb.fn.countAll()`, `eb.fn.sum(…)`, `.groupBy(…)`                                                                 |
| `$queryRaw\`…\``                                | ``sql`…`.execute(db.qb)`` — values become parameters                                                              |
| `$transaction(async (tx) => …)`                 | `db.transaction(async (tx) => …)`                                                                                 |
| `$transaction([a, b])`                          | the same callback form                                                                                            |

[Queries](./queries.md) and [Relational Queries](../db-relational-query.md) have the full surface.

### Find with related rows

::: code-group

```ts [Prisma]
const user = await prisma.user.findUnique({
  where: { email: 'ada@example.com' },
  include: {
    posts: { where: { published: false }, orderBy: { createdAt: 'desc' }, take: 5 },
  },
})
```

```ts [kick/db]
import { desc } from '@forinda/kickjs-db'

const user = await db.query.users.findFirst({
  where: (_u, eb) => eb('email', '=', 'ada@example.com'),
  with: {
    posts: {
      where: (_p, eb) => eb('published', '=', false),
      orderBy: (_p, eb) => desc(eb.ref('createdAt')),
      limit: 5,
    },
  },
})
```

:::

`user.posts` is typed from the relation, and the whole tree loads in one query.

### A filtered, paginated list

::: code-group

```ts [Prisma]
const page = await prisma.post.findMany({
  where: { published: true, title: { contains: 'ell' } },
  select: { id: true, title: true },
  orderBy: { createdAt: 'desc' },
  take: 10,
  skip: 0,
})
```

```ts [kick/db]
const page = await db
  .selectFrom('posts')
  .select(['id', 'title'])
  .where('published', '=', true)
  .where('title', 'like', '%ell%')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .offset(0)
  .execute()
```

:::

### Create a row with its children

::: code-group

```ts [Prisma]
const post = await prisma.user.create({
  data: {
    email: 'bob@example.com',
    name: 'Bob',
    posts: { create: { title: 'Hello', slug: 'hello', published: true } },
  },
})
```

```ts [kick/db]
const post = await db.transaction(async (tx) => {
  const author = await tx
    .insertInto('users')
    .values({ email: 'bob@example.com', name: 'Bob' })
    .returningAll()
    .executeTakeFirstOrThrow()
  return tx
    .insertInto('posts')
    .values({ authorId: author.id, title: 'Hello', slug: 'hello', published: true })
    .returningAll()
    .executeTakeFirstOrThrow()
})
```

:::

Inside `transaction()` the plain `db` joins it too, so a repository holding `db` takes part without being passed `tx` ([Transactions](./transactions.md)).

### Upsert and a counter

::: code-group

```ts [Prisma]
await prisma.user.upsert({
  where: { email: 'ada@example.com' },
  create: { email: 'ada@example.com', name: 'Ada Lovelace' },
  update: { name: 'Ada Lovelace' },
})

await prisma.post.update({ where: { id }, data: { views: { increment: 1 } } })
```

```ts [kick/db]
await db
  .insertInto('users')
  .values({ email: 'ada@example.com', name: 'Ada Lovelace' })
  .onConflict((oc) => oc.column('email').doUpdateSet({ name: (eb) => eb.ref('excluded.name') }))
  .execute()

await db
  .updateTable('posts')
  .set((eb) => ({ views: eb('views', '+', 1) }))
  .where('id', '=', id)
  .execute()
```

:::

Both are single statements, so they're safe under concurrency. MySQL uses `onDuplicateKeyUpdate` instead of `onConflict`.

### A duplicate

::: code-group

```ts [Prisma]
import { Prisma } from '@prisma/client'

try {
  await prisma.user.create({ data: { email } })
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    // already taken
  }
  throw err
}
```

```ts [kick/db]
import { UniqueViolationError } from '@forinda/kickjs-db'

try {
  await db.insertInto('users').values({ email }).execute()
} catch (err) {
  if (err instanceof UniqueViolationError) {
    // already taken — err.columns is ['email']
  }
  throw err
}
```

:::

| Prisma code                        | kick/db                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `P2002` unique constraint          | `UniqueViolationError` — carries `status: 409`, so unhandled it answers `409`                      |
| `P2003` foreign key                | `ForeignKeyViolationError`                                                                         |
| `P2011` null constraint            | `NotNullViolationError`                                                                            |
| `P2025` record to update not found | no error: check `numUpdatedRows` / `numDeletedRows`, or `executeTakeFirst()` returning `undefined` |
| `P2034` write conflict / deadlock  | `SerializationFailureError`, `DeadlockError` — `transaction({ retry: true })` runs it again        |

Each error names the `constraint`, `table` and `columns`, the same on Postgres, MySQL and SQLite ([Errors](./errors.md)).

## Types

| Prisma                                       | kick/db                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `import type { User } from '@prisma/client'` | `InferSelect<typeof users>` from `@forinda/kickjs-db/schema`                                     |
| `Prisma.UserCreateInput`                     | `InferInsert<typeof users>` — generated and defaulted columns are optional                       |
| `prisma generate` after a schema change      | nothing — the types follow `schema.ts` as you edit it                                            |
| Zod generators                               | `insertSchema(users)` / `updateSchema(users)` ([Validation from Tables](../db-table-schemas.md)) |

## Extending the client

| Prisma                                 | kick/db                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `$extends({ model: { user: { … } } })` | `db.$extends({ model: { users: { … } } })` ([Extensions](../db-extensions.md))                                           |
| `$extends({ result: { … } })`          | result extensions, same page                                                                                             |
| `$extends({ query: … })`, `$use`       | lifecycle events (`beforeQuery`, `query`, `slowQuery`, …) or a Kysely plugin ([Events and Plugins](./events-plugins.md)) |
| query logging (`log: ['query']`)       | `events: true` and `db.on('query', …)`                                                                                   |

## Not there (yet)

- **`@updatedAt`, soft delete, optimistic locking** — set the column in your update for now; auto-managed columns are planned ([D.10](../roadmap.md)).
- **`upsert` / `findOrCreate` as methods** — use `onConflict` as above; a dedicated API is planned (D.11).
- **`prisma db seed`** — write a seed as an empty migration (`kick db generate seed_roles --empty`) or a script using the client; a seed command is deferred (D.2).
- **Read replicas** — planned (D.12).
- **Prisma Studio** — the KickJS [DevTools](../devtools.md) Database tab shows the queries your app runs; there is no data editor.
- **`db push`** — deliberately absent; every change goes through a reviewed migration.

## Testing

Prisma tests usually mean a Docker database and a reset between runs. With kick/db you can build the whole schema in an in-memory SQLite database in milliseconds, roll each test back, or run against a real Postgres container — [Testing](./testing.md).

## Moving an existing Prisma project

You don't convert `schema.prisma` by hand. Point `kick db introspect` at the live database, read the schema it writes, and baseline the migration history so kick/db starts from what's already there. Leave `_prisma_migrations` alone until cutover, and expect introspected names to be the database's (`@map` targets), not your model names. [Adopting on an Existing DB](./adopting.md) walks through it, including running both clients side by side while you move call sites over.
