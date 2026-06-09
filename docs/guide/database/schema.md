# Schema

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

## `table(name, columns, constraints?)`

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

The third argument receives a `refs` object — one `ColumnRef` per column — for declaring multi-column indexes and unique constraints. See [Indexes & unique constraints](#indexes-unique-constraints).

## Column builders

All cross-dialect builders are imported from the package root. Each carries a phantom TypeScript type that flows into the row shape.

| Builder                 | SQL type           | TS type                        |
| ----------------------- | ------------------ | ------------------------------ |
| `serial()`              | `serial`           | `number` (generated, not-null) |
| `bigSerial()`           | `bigserial`        | `bigint` (generated, not-null) |
| `smallSerial()`         | `smallserial`      | `number` (generated, not-null) |
| `integer()`             | `integer`          | `number`                       |
| `bigint()`              | `bigint`           | `bigint`                       |
| `smallint()`            | `smallint`         | `number`                       |
| `decimal(p?, s?)`       | `decimal(p, s)`    | `string`                       |
| `numeric(p?, s?)`       | `numeric(p, s)`    | `string`                       |
| `real()`                | `real`             | `number`                       |
| `doublePrecision()`     | `double precision` | `number`                       |
| `varchar(length = 255)` | `varchar(n)`       | `string`                       |
| `char(length = 1)`      | `char(n)`          | `string`                       |
| `text()`                | `text`             | `string`                       |
| `boolean()`             | `boolean`          | `boolean`                      |
| `timestamp()`           | `timestamp`        | `Date`                         |
| `timestamptz()`         | `timestamptz`      | `Date`                         |
| `date()`                | `date`             | `Date`                         |
| `time()`                | `time`             | `string`                       |
| `interval()`            | `interval`         | `string`                       |
| `uuid()`                | `uuid`             | `string`                       |
| `json<T>()`             | `json`             | `T`                            |
| `jsonb<T>()`            | `jsonb`            | `T`                            |
| `bytea()`               | `bytea`            | `Uint8Array`                   |

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

### Generated columns

`serial()` / `bigSerial()` / `smallSerial()` are always generated and not-null. The date and uuid builders expose expression-default helpers:

```ts
uuid().defaultRandom() // DEFAULT gen_random_uuid()
timestamp().defaultNow() // DEFAULT CURRENT_TIMESTAMP
timestamptz().defaultNow()
```

A generated column wraps in Kysely's `Generated<T>` in the inferred row type, so it is optional on insert but always present on select. Chaining works in either order:

```ts
uuid().primaryKey().defaultRandom()
uuid().defaultRandom().primaryKey() // also valid
```

### Typed JSON

`json<T>()` and `jsonb<T>()` carry the declared shape through inference instead of widening to `unknown`:

```ts
const tasks = table('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  meta: jsonb<{ tags: string[]; pinned: boolean }>(),
})
// db.selectFrom('tasks').select('meta') → meta: { tags: string[]; pinned: boolean } | null
```

## Foreign keys

Declare a foreign key with `.references()` on the column. The target is passed as a **thunk** so self-referencing and forward-referencing tables work without tripping over declaration order:

```ts
import { table, uuid, varchar, type ColumnRef } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
})

export const posts = table('posts', {
  id: uuid().primaryKey().defaultRandom(),
  authorId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
})
```

`onDelete` / `onUpdate` accept the standard FK actions (`'cascade'`, `'restrict'`, `'set_null'`, `'set_default'`, `'no_action'`). Both default to `'no_action'`.

For a self-reference, annotate the thunk return type so the const can refer to itself:

```ts
export const categories = table('categories', {
  id: uuid().primaryKey().defaultRandom(),
  parentId: uuid().references((): ColumnRef => categories.id),
})
```

## Indexes & unique constraints

Multi-column indexes and unique constraints live in the third argument to `table()`. The `index()` and `unique()` helpers take a name and an `.on(...columns)` list:

```ts
import { table, uuid, varchar, integer, index, unique } from '@forinda/kickjs-db'

export const posts = table(
  'posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: integer().notNull(),
    slug: varchar(200).notNull(),
  },
  (t) => ({
    authorIdx: index('posts_author_idx').on(t.authorId),
    slugUnique: unique('posts_slug_unique').on(t.authorId, t.slug),
  }),
)
```

Keeping constraints in one callback means every constraint name lives in a single place, which keeps migration diffing simple.

## Postgres enums

`pgEnum()` is imported from the `@forinda/kickjs-db/pg` subpath. It returns a column factory whose phantom type narrows to the union of declared values:

```ts
import { table, uuid } from '@forinda/kickjs-db'
import { pgEnum } from '@forinda/kickjs-db/pg'

export const taskStatus = pgEnum('task_status', 'todo', 'in_progress', 'done')

export const tasks = table('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  status: taskStatus().notNull().default("'todo'"),
})
// db.selectFrom('tasks').select('status') → status: 'todo' | 'in_progress' | 'done'
```

The enum name and values are tracked so the migration pipeline can emit `CREATE TYPE … AS ENUM (...)` and handle value add / rename / removal. Enum value removal is gated behind a confirmation flag at apply time — see [Migrations](./migrations#enum-value-removal).

::: warning Postgres only
`pgEnum` (and the other `@forinda/kickjs-db/pg` types) are dialect-specific. Importing them while targeting SQLite or MySQL will not produce a valid migration for those dialects.
:::

### Other Postgres-only types

The `@forinda/kickjs-db/pg` subpath also exports:

```ts
import { tsvector, vector, citext, money, inet, cidr, xml } from '@forinda/kickjs-db/pg'

vector(384) // pgvector embedding column → number[]
citext() // case-insensitive text → string
tsvector() // full-text search vector → string
```

These are subpath-imported (not from the package root) so you can't accidentally reach for a `tsvector` while targeting another dialect.

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

Export the relations alongside the tables (`export * from './schema'`) so the client picks them up. They power `db.query.users.findMany({ with: { posts: true } })` — see [Queries](./queries#relational-queries).

## Type inference

The schema feeds inference automatically through `createDbClient({ schema })`. To name the row shape yourself, use `SchemaToTypes`:

```ts
import { type SchemaToTypes } from '@forinda/kickjs-db'
import * as schema from './schema'

type DB = SchemaToTypes<typeof schema>
// DB['users'] → { id: Generated<string>; email: string; name: string | null; ... }
```

The full inference story — `Generated<T>` wrapping, nullability, `KickDbRegister` augmentation — is covered in [Schema Types](../db-schema-types).
