---
description: Coming to kick/db from Drizzle — how pgTable, relations, db.query, the core query API, drizzle-kit and $inferSelect map onto kick/db, and where the two differ.
---

# Coming from Drizzle

Of the established ORMs, Drizzle is closest to kick/db. Both are code-first — the schema is TypeScript, the types come from it with no generate step — both sit on a SQL-shaped query builder, and both offer a relational `db.query` API with `with`. `relations()` is even spelled the same way.

The differences are in the details: kick/db's builder is [Kysely](https://kysely.dev), so columns are named with strings (`where('email', '=', x)`) rather than imported operators (`eq(users.email, x)`); migrations are reviewed before they run and can be rolled back; database errors arrive as typed classes; and the client plugs into KickJS's DI, transactions and lifecycle.

The examples use Postgres. Everything kick/db shown here runs as written.

## The schema

::: code-group

```ts [Drizzle]
import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 120 }),
  createdAt: timestamp().notNull().defaultNow(),
})

export const posts = pgTable(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar({ length: 200 }).notNull(),
    slug: varchar({ length: 200 }).notNull(),
    published: boolean().notNull().default(false),
    views: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('posts_author_idx').on(t.authorId),
    unique('posts_author_slug_unique').on(t.authorId, t.slug),
  ],
)

export const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

```ts [kick/db]
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

:::

| Drizzle                                            | kick/db                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pgTable` / `mysqlTable` / `sqliteTable`           | one `table()` for every dialect — the dialect is picked at generate time and in the client    |
| `varchar('email', { length: 255 })`, `casing`      | `varchar(255)` — the key is the column name; there is no name override or casing option       |
| extra config `(t) => [index(…).on(…)]`             | `(t) => ({ name: index(…).on(…) })` — an object, each constraint keyed                        |
| `primaryKey({ columns: [t.a, t.b] })`              | `primaryKey().on(t.a, t.b)` ([Keys & Constraints](./constraints.md))                          |
| `check('name', sql\`…\`)`                          | `check('name', 'sql as a string')`                                                            |
| `.default(false)`                                  | `.default('false')` — the SQL default as written                                              |
| `.defaultRandom()`, `.defaultNow()`                | the same                                                                                      |
| `.$defaultFn(() => …)`, `.$onUpdate(() => …)`      | no equivalent — set the value in your insert or update                                        |
| `.references(() => t.id, { onDelete })`            | the same; actions are `'cascade'`, `'restrict'`, `'set_null'`, `'set_default'`, `'no_action'` |
| `pgEnum('role', ['admin', 'member'])`              | `pgEnum('role', 'admin', 'member')` from `@forinda/kickjs-db/pg` — values as arguments        |
| `customType<{ data: T }>({ … })`                   | `customType<T>({ dataType, toDriver, fromDriver })` ([Extensions](../db-extensions.md))       |
| `relations(…)` with `one` / `many`, `relationName` | the same                                                                                      |
| —                                                  | a [class or fluent form](../db-table-forms.md) of the same table, if you prefer               |

Every column type is on [Tables & Columns](./schema.md).

## Migrations

| drizzle-kit                        | kick/db                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `drizzle.config.ts`                | a `db` block in `kick.config.ts` ([Database CLI](./cli.md))                               |
| `drizzle-kit generate`             | `kick db generate <name>` — `up.sql`, `down.sql`, `snapshot.json`, `meta.json`            |
| `drizzle-kit generate --custom`    | `kick db generate <name> --empty`                                                         |
| `drizzle-kit migrate`, `migrate()` | `kick db migrate latest`, or `kickDbAdapter({ migrationsOnBoot: 'apply' })` on boot       |
| no down migrations                 | `kick db migrate down` / `rollback` run each migration's `down.sql`                       |
| —                                  | `kick db migrate review <id>`: unreviewed migrations don't run outside development        |
| `drizzle-kit check`                | the runner checks every migration's hash, and the live schema for drift, before applying  |
| `drizzle-kit pull`                 | `kick db introspect`                                                                      |
| `drizzle-kit push`                 | no equivalent: every change is a migration                                                |
| `drizzle-kit studio`               | none — the KickJS [DevTools](../devtools.md) Database tab shows the queries your app runs |

The snapshots don't interchange. To move an existing project, baseline rather than convert history — see below.

## Queries

### The relational API

`db.query` works the way you know, with Kysely's expression builder in place of Drizzle's operator helpers:

::: code-group

```ts [Drizzle]
const user = await db.query.users.findFirst({
  where: (u, { eq }) => eq(u.email, 'ada@example.com'),
  with: {
    posts: {
      where: (p, { eq }) => eq(p.published, false),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
      limit: 5,
    },
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

| Drizzle `db.query`                   | kick/db `db.query`                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `findMany`, `findFirst`              | the same, plus `findUnique`                                                                                  |
| `where: (t, { eq, and, or }) => …`   | `where: (t, eb) => eb('col', '=', v)`, `eb.and([…])`, `eb.or([…])`                                           |
| `orderBy: (t, { asc, desc }) => […]` | `orderBy: (t, eb) => [desc(eb.ref('col')), asc(eb.ref('other'))]` — `asc` / `desc` from `@forinda/kickjs-db` |
| `limit`, `offset`, nested `with`     | the same                                                                                                     |
| `columns: { id: true }`, `extras`    | not supported — select columns with the query builder                                                        |
| —                                    | `maxDepth` guards runaway nesting; `signal` cancels the query                                                |

[Relational Queries](../db-relational-query.md) has the details.

### The query builder

Drizzle's core API imports a column object and an operator for each condition; Kysely names the column and the operator as strings, checked against the schema:

| Drizzle                                           | kick/db                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `db.select().from(posts)`                         | `db.selectFrom('posts').selectAll()`                                                   |
| `db.select({ id: posts.id }).from(posts)`         | `db.selectFrom('posts').select(['id'])`                                                |
| `.where(eq(posts.id, id))`                        | `.where('id', '=', id)`                                                                |
| `and(…)`, `or(…)`, `inArray`, `isNull`, `like`    | chained `.where`, `eb.or([…])`, `'in'`, `'is', null`, `'like'`                         |
| `.orderBy(desc(posts.createdAt))`                 | `.orderBy('createdAt', 'desc')`                                                        |
| `.innerJoin(users, eq(posts.authorId, users.id))` | `.innerJoin('users', 'users.id', 'posts.authorId')`                                    |
| `db.insert(users).values({…}).returning()`        | `db.insertInto('users').values({…}).returningAll()`                                    |
| `db.update(users).set({…}).where(…)`              | `db.updateTable('users').set({…}).where(…)`                                            |
| `db.delete(users).where(…)`                       | `db.deleteFrom('users').where(…)`                                                      |
| `.onConflictDoUpdate({ target, set })`            | `db.upsert(table, { values, target, update })` — or `.onConflict(…)` for full control  |
| `db.$count(posts)`                                | `select((eb) => eb.fn.countAll().as('n'))`                                             |
| `db.execute(sql\`…\`)`                            | ``sql`…`.execute(db.qb)`` — `sql` comes from `kysely`                                  |
| results run with `await`                          | end the chain with `.execute()`, `.executeTakeFirst()` or `.executeTakeFirstOrThrow()` |

[Queries](./queries.md) and [Raw SQL & Recipes](./raw-sql.md) cover the rest.

### A filtered, paginated list

::: code-group

```ts [Drizzle]
import { and, desc, eq, like } from 'drizzle-orm'

const page = await db
  .select({ id: posts.id, title: posts.title })
  .from(posts)
  .where(and(eq(posts.published, true), like(posts.title, '%ell%')))
  .orderBy(desc(posts.createdAt))
  .limit(10)
  .offset(0)
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

### Upsert and a counter

::: code-group

```ts [Drizzle]
await db
  .insert(users)
  .values({ email: 'ada@example.com', name: 'Ada Lovelace' })
  .onConflictDoUpdate({ target: users.email, set: { name: sql`excluded.name` } })

await db
  .update(posts)
  .set({ views: sql`${posts.views} + 1` })
  .where(eq(posts.id, id))
```

```ts [kick/db]
await db.upsert('users', {
  values: { email: 'ada@example.com', name: 'Ada Lovelace' },
  target: ['email'],
})

await db
  .updateTable('posts')
  .set((eb) => ({ views: eb('views', '+', 1) }))
  .where('id', '=', id)
  .execute()
```

:::

### Transactions

::: code-group

```ts [Drizzle]
const post = await db.transaction(async (tx) => {
  const [author] = await tx
    .insert(users)
    .values({ email: 'bob@example.com', name: 'Bob' })
    .returning()
  const [post] = await tx
    .insert(posts)
    .values({ authorId: author.id, title: 'Hello', slug: 'hello', published: true })
    .returning()
  return post
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

Two differences. Roll back by throwing — there's no `tx.rollback()`. And the transaction follows the call chain: inside `transaction()`, the plain `db` joins it, so a repository that only holds `db` takes part without being passed `tx`. Isolation levels, savepoints, `afterCommit` and retry on serialization failures are on [Transactions](./transactions.md).

### Errors

Drizzle hands you the driver's error, so you check Postgres' `23505` yourself (recent versions wrap it, with the driver error as `cause`). kick/db translates driver errors into classes, the same on Postgres, MySQL and SQLite:

```ts
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

`ForeignKeyViolationError`, `CheckViolationError`, `NotNullViolationError`, `SerializationFailureError`, `DeadlockError` and `ConnectionError` follow the same pattern. Each carries the `constraint`, `table` and `columns` involved when the driver reports them — `constraint` and `table` may be missing and `columns` empty, and the transaction and connection errors usually have none. An unhandled `UniqueViolationError` answers `409` in a KickJS app. [Errors](./errors.md) lists them.

## Types and validation

| Drizzle                                   | kick/db                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `typeof users.$inferSelect`               | `InferSelect<typeof users>` from `@forinda/kickjs-db/schema`                                                   |
| `typeof users.$inferInsert`               | `InferInsert<typeof users>`                                                                                    |
| `drizzle-zod` `createInsertSchema(users)` | `insertSchema(users)` — also `updateSchema`, `selectSchema` ([Validation from Tables](../db-table-schemas.md)) |
| `drizzle(pool, { schema })`               | `createDbClient({ schema, dialect: pgDialect({ pool }) })`                                                     |

## Hooks into the client

| Drizzle                         | kick/db                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `logger: true`, a custom logger | `events: true` and `db.on('query' \| 'slowQuery' \| 'queryError', …)` ([Events and Plugins](./events-plugins.md)) |
| —                               | `db.$extends({ model: { users: { … } } })` — per-table methods ([Extensions](../db-extensions.md))                |
| —                               | Kysely plugins via `createDbClient({ plugins })`                                                                  |

## Not there (yet)

- **`$defaultFn`, `$onUpdate` with a function** — set the value yourself. For the common cases there are [maintained columns](./schema.md#columns-kick-db-maintains): `onUpdateNow()`, `version()`, `softDelete()`.
- **`columns` / `extras` in `db.query`** — use the query builder when you need a narrower select.
- **A name or casing override for columns** — the key is the column name.
- **`drizzle-kit push` and Studio** — every change goes through a reviewed migration; there's no data browser.
- **`drizzle-seed`** (generated fake data) — no generator; write seed files for [`kick db seed`](./cli.md#seed) by hand or with a faker library.

## Testing

You can build the whole schema in an in-memory SQLite database in milliseconds, roll each test back in a transaction, or run against a Postgres container — [Testing](./testing.md).

## Moving an existing Drizzle project

Translating the schema is mostly mechanical: rename `pgTable` to `table`, drop the column-name arguments (or name the keys after the columns), turn the extra-config array into an object, and quote defaults. The migration history doesn't carry over — drizzle-kit snapshots and kick/db snapshots are different formats. Introspect or translate the schema, then baseline so kick/db starts from the database as it is; [Adopting on an Existing DB](./adopting.md) shows how, and how to run both clients side by side while you move call sites.
