# Tables and Columns

A `@forinda/kickjs-db` schema is a plain TypeScript module that exports `table()` declarations. The same file is the source of truth for runtime SQL, TypeScript inference, and migration diffing — there is no second declaration to drift against.

```ts
// src/db/schema.ts
import { table, uuid, varchar, text, timestamp, boolean } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  bio: text(),
  isActive: boolean().notNull().default('true'),
  createdAt: timestamp().notNull().defaultNow(),
})
```

## `table(name, columns, options?)`

`table()` takes a literal table name, a record of column builders, and an optional constraints callback. The literal name is preserved at the type level so `SchemaToTypes<S>` can index by it:

```ts
export const posts = table(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: varchar(200).notNull(),
    body: text().notNull(),
  },
  (t) => ({
    titleIdx: index('posts_title_idx').on(t.title),
  }),
)
```

The third argument receives a `refs` object — one `ColumnRef` per column — for declaring multi-column indexes and unique constraints. See [Keys and Constraints → Indexes & unique constraints](./constraints#indexes-unique-constraints).

It can also be an object holding that callback and the table's comment:

```ts
export const posts = table('posts', columns, {
  comment: 'Published and draft posts',
  constraints: (t) => ({ titleIdx: index('posts_title_idx').on(t.title) }),
})
```

### Comments

`.comment(text)` on a column, and `comment` in a table's options, are stored in the database, where anyone reading the schema sees them (`\d+ posts` in psql, `SHOW FULL COLUMNS` in MySQL). Changing one generates a migration: `COMMENT ON` on Postgres, a restated column or `ALTER TABLE … COMMENT` on MySQL. `kick db introspect` reads them back. SQLite has no comments, so there they're ignored and never produce a migration.

```ts
email: varchar(200).notNull().comment('Sign-in address, lowercased'),
```

## Column builders

All cross-dialect builders are imported from the package root. Each carries a phantom TypeScript type that flows into the row shape.

| Builder                      | SQL type           | TS type                        |
| ---------------------------- | ------------------ | ------------------------------ |
| `serial()`                   | `serial`           | `number` (generated, not-null) |
| `bigSerial()`                | `bigserial`        | `bigint` (generated, not-null) |
| `smallSerial()`              | `smallserial`      | `number` (generated, not-null) |
| `integer()`                  | `integer`          | `number`                       |
| `bigint({ mode? })`          | `bigint`           | `bigint` (or per `mode`)       |
| `smallint()`                 | `smallint`         | `number`                       |
| `decimal(p?, s?, { mode? })` | `decimal(p, s)`    | `string` (or per `mode`)       |
| `numeric(p?, s?, { mode? })` | `numeric(p, s)`    | `string` (or per `mode`)       |
| `real()`                     | `real`             | `number`                       |
| `doublePrecision()`          | `double precision` | `number`                       |
| `varchar(length = 255)`      | `varchar(n)`       | `string`                       |
| `char(length = 1)`           | `char(n)`          | `string`                       |
| `text()`                     | `text`             | `string`                       |
| `boolean()`                  | `boolean`          | `boolean`                      |
| `timestamp()`                | `timestamp`        | `Date`                         |
| `timestamptz()`              | `timestamptz`      | `Date`                         |
| `date()`                     | `date`             | `Date`                         |
| `time()`                     | `time`             | `string`                       |
| `interval()`                 | `interval`         | `string`                       |
| `uuid()`                     | `uuid`             | `string`                       |
| `json<T>()`                  | `json`             | `T`                            |
| `jsonb<T>()`                 | `jsonb`            | `T`                            |
| `bytea()`                    | `bytea`            | `Uint8Array`                   |

**`mode` for big and exact numbers.** Drivers disagree on 64-bit integers: `pg` returns a string, better-sqlite3 a number. Pick what you get back, and the type follows:

```ts
bigint({ mode: 'bigint' }) // 9007199254740993n — exact
bigint({ mode: 'number' }) // a number — exact up to 2^53
bigint({ mode: 'string' }) // '9007199254740993'
numeric(12, 2, { mode: 'number' }) // 19.99 instead of '19.99'
```

Without `mode`, `bigint()` returns the driver's value as it comes. On MySQL, give the pool `supportBigNumbers: true, bigNumberStrings: true`, or mysql2 reads a BIGINT as a number and loses digits past 2^53 before `mode` sees it. `mode` applies to nested rows from `db.query` too.

`decimal` and `numeric` are strings so no digit is lost — `decimal(12, 2)` reads back as `'0.10'`, not `0.1`. Do arithmetic on them with a decimal library, or in SQL. SQLite has no exact decimal type: it stores a float, which kick/db reads back as the same string at the column's scale, exact up to 15 significant digits. An aggregate such as `sum(amount)` has no column to decode and comes back as a number on SQLite.

### Modifiers

Every builder supports a chainable set of modifiers:

```ts
varchar(255).notNull() // drop `| null` from the TS type
uuid().primaryKey() // PRIMARY KEY (implies NOT NULL)
varchar(255).unique() // UNIQUE
integer().default('0') // DEFAULT 0 (marks column generated)
text().array() // text[]  → TS type becomes T[]
```

- `.notNull()` / `.primaryKey()` stamp the column NOT NULL and remove `| null` from its inferred type.
- `.default(value)` sets a SQL default and marks the column generated, so you can omit it on insert. Pass the SQL literal as a string: `.default('true')`, `.default('0')`, `.default("'pending'")`.
- `.array()` wraps the SQL type in `[]` and the TS type in `T[]`.
- `.comment(text)` stores a comment with the column ([Comments](#comments)).

### Defaults computed in JS

When a default can't be SQL (an id from your own generator, a value from config, who made the change), compute it in JS:

```ts
import { ulid } from 'ulid'

export const notes = table('notes', {
  id: text()
    .primaryKey()
    .$defaultFn(() => ulid()), // each inserted row that doesn't set it
  body: text().notNull(),
  editedBy: text().$onUpdate(() => currentUser()), // each update that doesn't set it
})
```

- **`$defaultFn(fn)`** runs once per inserted row that leaves the column out, so a multi-row insert gets a fresh value per row. The column is optional on insert.
- **`$onUpdate(fn)`** runs on every update, and an upsert's update branch, that doesn't set the column. Inserts don't call it.
- Neither is part of the schema: the database has no default, so raw `sql` inserts must set the column themselves.

### Columns kick/db maintains

Three markers hand a column's upkeep to kick/db. They change the queries it sends, not the schema — no migration involved.

```ts
import { table, serial, text, timestamp, version } from '@forinda/kickjs-db'

export const docs = table('docs', {
  id: serial().primaryKey(),
  title: text().notNull(),
  version: version(), // integer, not null, starts at 0, +1 on every update
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().onUpdateNow(), // now() on every update
  deletedAt: timestamp().softDelete(), // set = deleted; db.query skips the row
})
```

- **`.onUpdateNow()`** — every `updateTable('docs')` that doesn't set the column itself sets it to the current time; so does an [upsert](./queries.md#upsert-and-find-or-create)'s update branch. Set it explicitly and your value wins.
- **`version()`** — every update adds 1. For optimistic locking, read the row, then update with `.where('version', '=', read.version)`: `numUpdatedRows === 0n` means someone saved first.

  ```ts
  const { numUpdatedRows } = await db
    .updateTable('docs')
    .set({ title })
    .where('id', '=', doc.id)
    .where('version', '=', doc.version)
    .executeTakeFirst()
  if (numUpdatedRows === 0n)
    throw HttpException.conflict('Changed by someone else — reload and retry')
  ```

- **`.softDelete()`** — on a nullable timestamp. [Relational reads](../db-relational-query.md) (`db.query`) skip rows where it's set, at the top level and in every `with`; pass `withDeleted: true` at a level to include them there. Soft-delete by setting it — `updateTable('docs').set({ deletedAt: new Date() })` — and restore by setting it back to `null`. The query builder (`selectFrom`) is plain SQL and sees every row; add `.where('deletedAt', 'is', null)` there yourself.

These apply to queries kick/db builds: raw `sql` and a hand-written `UPDATE` don't maintain them.

### Database-assigned values

`serial()` / `bigSerial()` / `smallSerial()` are numbered by the database and not-null. The date and uuid builders expose expression-default helpers:

```ts
uuid().defaultRandom() // DEFAULT gen_random_uuid()
timestamp().defaultNow() // DEFAULT CURRENT_TIMESTAMP (milliseconds on SQLite)
timestamptz().defaultNow()
```

A column with a default wraps in Kysely's `Generated<T>` in the inferred row type, so it is optional on insert but always present on select. Chaining works in either order:

```ts
uuid().primaryKey().defaultRandom()
uuid().defaultRandom().primaryKey() // also valid
```

### Generated columns

A generated column is computed by the database from the row's other columns, on every write. Declare it with the SQL expression:

```ts
export const orders = table('orders', {
  id: integer().generatedAlwaysAsIdentity().primaryKey(),
  quantity: integer().notNull(),
  price: numeric(12, 2).notNull(),
  total: numeric(12, 2).generatedAlwaysAs('price * quantity'),
  summary: text().generatedAlwaysAs("quantity || ' x ' || price", { stored: false }),
})
```

- **Stored or virtual.** Stored (the default) computes the value on write and keeps it, so it can be indexed. `{ stored: false }` computes it on read: MySQL, SQLite and Postgres 18+.
- **Read-only.** It types as Kysely's `GeneratedAlways<T>`, so `insertInto` / `updateTable` reject it at compile time. `insertSchema` and `updateSchema` leave it out, and the database refuses a write to it.
- **The SQL is passed through.** Name columns as the database knows them, and write the expression for your dialect.
- **Changing it.**
  - On Postgres, a new expression is applied in place with `SET EXPRESSION` (Postgres 17+).
  - Removing `generatedAlwaysAs` keeps the values as a plain column (`DROP EXPRESSION`).
  - Making an existing column generated, or switching stored and virtual, re-creates the column. Its values are computed again, but an index on it is dropped with it.
  - On MySQL the column is restated in place.
  - On SQLite the table is rebuilt with its rows. SQLite also rebuilds to add a stored generated column, which `ALTER TABLE` can't.

**Identity columns** (Postgres) are the SQL-standard replacement for `serial`:

| Builder                           | SQL                                | On insert                                  |
| --------------------------------- | ---------------------------------- | ------------------------------------------ |
| `.generatedAlwaysAsIdentity()`    | `GENERATED ALWAYS AS IDENTITY`     | always numbered; giving a value is refused |
| `.generatedByDefaultAsIdentity()` | `GENERATED BY DEFAULT AS IDENTITY` | numbered unless a value is given           |

Adding, removing or switching identity on an existing column alters it in place. MySQL and SQLite have no identity columns, so they're refused there: use `serial()`.

`kick db introspect` reads both back: identity and generated columns on Postgres, and generated columns on SQLite. Drift checks leave out the generated expression, which the database rewrites into its own form.

### Typed JSON

`json<T>()` and `jsonb<T>()` carry the declared shape through inference instead of widening to `unknown`:

```ts
const tasks = table('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  meta: jsonb<{ tags: string[]; pinned: boolean }>(),
})
// db.selectFrom('tasks').select('meta') → meta: { tags: string[]; pinned: boolean } | null
```

## Column names: `casing`

By default a key is the column's name: `firstName` is the `firstName` column. To keep camelCase keys in TypeScript over a snake_case database, set `casing` in both places that need to agree, the client and `kick.config.ts`:

```ts
// src/db/client.ts
export const db = createDbClient({ schema, dialect: pgDialect({ pool }), casing: 'snake_case' })

// kick.config.ts
export default defineConfig({
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres',
    casing: 'snake_case',
  },
})
```

```ts
export const blogPosts = table('blogPosts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id), // column author_id
  postTitle: text().notNull(), // column post_title
})
// → CREATE TABLE "blog_posts" ("id" serial, "author_id" integer, "post_title" text, …)
```

- **Migrations** name tables, columns, keys and foreign keys in snake_case. Names kick/db derives (`blog_posts_author_id_fk`) follow; names you write (`index('posts_by_author')`) are kept as written.
- **Queries** convert both ways: `db.selectFrom('blogPosts').select('postTitle')` runs `select "post_title" from "blog_posts"`, and every row (raw SQL results and `db.query` nested rows included) comes back with camelCase keys. It's Kysely's `CamelCasePlugin`, applied after kick/db's own plugins on the way out and before them on the way back.
- **SQL you write stays SQL.** CHECK expressions, `where` predicates of partial indexes, `generatedAlwaysAs` and `sql` templates name columns as the database does: `check('positive', 'post_count >= 0')`.
- **Keys must be camelCase.** A key that is already snake_case (`created_at`) comes back from the database as `createdAt`.
- **Test helpers and introspection follow.** `createTestDb({ schema, casing })` takes the same option, and `kick db introspect` with `casing` set renders camelCase keys.
- **Migrating an existing project** to `casing` renames every camelCase table and column. Generate that migration on its own and read it: it's a rename per column, which [rename prompts](./migrations.md#renames) let you confirm.

A name override for a single column isn't supported; `casing` applies to all of them.

## Keys and constraints

Foreign keys, indexes, unique constraints, composite primary keys and CHECK constraints are on [Keys and Constraints](./constraints).

## Postgres enums

`pgEnum()` is imported from the `@forinda/kickjs-db/pg` subpath. It returns a column factory whose phantom type narrows to the union of declared values:

```ts
import { table, uuid } from '@forinda/kickjs-db'
import { pgEnum } from '@forinda/kickjs-db/pg'

export const taskStatus = pgEnum('task_status', 'todo', 'in_progress', 'done')

export const tasks = table('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  status: taskStatus().notNull().default('todo'),
})
// db.selectFrom('tasks').select('status') → status: 'todo' | 'in_progress' | 'done'
```

Pass the default as the bare value — `.default('todo')`, not `.default("'todo'")`. The emitter quotes it for you; pre-quoting produces `DEFAULT '''todo'''`, which is the four-character string `'todo'` and not a member of the type.

The enum name and values are tracked so the migration pipeline can emit `CREATE TYPE … AS ENUM (...)` and handle value add / rename / removal. Enum value removal is gated behind a confirmation flag at apply time — see [Migrations](./migrations#enum-value-removal).

`kick db introspect` reads enum types back out, so adopting an existing database gives you the declarations too:

```ts
export const mood = pgEnum('mood', 'sad', 'ok', 'happy')

export const people = table('people', {
  id: serial().primaryKey(),
  mood: mood().notNull().default('ok'),
})
```

Value order is preserved as declared, because for an enum it is part of the type — comparisons and `ORDER BY` follow it.

::: warning Postgres only
`pgEnum` (and the other `@forinda/kickjs-db/pg` types) are dialect-specific. Importing them while targeting SQLite or MySQL will not produce a valid migration for those dialects.
:::

### Other Postgres-only types

The `@forinda/kickjs-db/pg` subpath also exports:

```ts
import { tsvector, vector, halfvec, point, geometry, macaddr, citext } from '@forinda/kickjs-db/pg'

vector(384) // pgvector embedding → number[]
halfvec(384) // half-precision pgvector embedding (pgvector 0.7+) → number[]
point() // geometric point → { x, y }
geometry('Point', 4326) // PostGIS geometry → string (hex EWKB out, WKT/EWKT in)
macaddr() // MAC address → string (also macaddr8())
citext() // case-insensitive text → string
tsvector() // full-text search vector → string
```

`vector`, `halfvec` and `point` carry codecs, so you write and read the JS value. Before, a `vector` came back as the text `'[1,2,3]'` and an inserted array was sent as a Postgres array literal. `vector` and `halfvec` need the `vector` extension, and `geometry` needs `postgis`: create the extension in a migration before the table. For `geometry`, convert in SQL with `ST_AsGeoJSON(...)` / `ST_GeomFromGeoJSON(...)`. Also exported: `money`, `inet`, `cidr`, `xml`.

These are subpath-imported (not from the package root) so you can't accidentally reach for a `tsvector` while targeting another dialect.

## MySQL-only types

The `@forinda/kickjs-db/mysql` subpath exports MySQL's own column types:

```ts
import { mysqlEnum, unsigned, tinyint, mediumint, datetime } from '@forinda/kickjs-db/mysql'

export const events = table('events', {
  id: serial().primaryKey(),
  status: mysqlEnum('Draft', 'Live').notNull(), // ENUM, typed 'Draft' | 'Live'
  hits: unsigned(integer()).notNull(), // INT UNSIGNED, 0…4294967295
  level: unsigned(tinyint()), // TINYINT UNSIGNED, 0…255
  bucket: mediumint(), // MEDIUMINT
  at: datetime(3).notNull(), // DATETIME(3) → Date
})
```

- `mysqlEnum` keeps its values' case through migrations, introspection and validation.
- `unsigned()` takes any integer column (`integer`, `smallint`, `bigint`, `tinyint`, `mediumint`), keeps its type and chain, and widens the validators' range.
- `datetime` isn't converted to UTC as `TIMESTAMP` is, and covers years 1000–9999.

## Custom column types

`customType<T>()` lets a project introduce a typed column that isn't in the built-in DSL — encrypted strings, ULIDs, PostGIS geometry — without forking the package. It takes a `dataType` thunk plus optional `toDriver` / `fromDriver` codecs:

```ts
import { customType, table, timestamp } from '@forinda/kickjs-db'

const ulid = customType<string>({
  dataType: () => 'char(26)',
  toDriver: (s) => s,
  fromDriver: (raw) => String(raw),
})

export const events = table('events', {
  id: ulid().primaryKey(),
  ts: timestamp().notNull().defaultNow(),
})
```

The phantom `T` flows through `SchemaToTypes<S>` exactly like any built-in builder, so `db.selectFrom('events').select('id')` types `id: string`. The codecs run automatically on insert / update (`toDriver`) and on selected rows (`fromDriver`).

## Relations (for `db.query`)

Relations are declared **separately** from `table()`, after both tables exist, with the `relations()` helper. They are query-time joining sugar for the relational query layer — they do not emit DDL:

```ts
import { relations } from '@forinda/kickjs-db'

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

- `one(target, { fields, references })` — a to-one relation; `fields` are the local FK columns, `references` are the target's columns.
- `many(target)` — a to-many relation.

When a source table has multiple foreign keys to the same target, pair the two sides with a matching `relationName`:

```ts
export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, { fields: [messages.senderId], references: [users.id], relationName: 'sent' }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: 'received',
  }),
}))
```

Export the relations alongside the tables (`export * from './schema'`) so the client picks them up. They power `db.query.users.findMany({ with: { posts: true } })` — see [Queries](../db-relational-query).

## Type inference

The schema feeds inference automatically through `createDbClient({ schema })`. To name the row shape yourself, use `SchemaToTypes`:

```ts
import { type SchemaToTypes } from '@forinda/kickjs-db'
import * as schema from './schema'

type DB = SchemaToTypes<typeof schema>
// DB['users'] → { id: Generated<string>; email: string; name: string | null; ... }
```

The full inference story — `Generated<T>` wrapping, nullability, `KickDbRegister` augmentation — is covered in [Schema Types](../db-schema-types).
