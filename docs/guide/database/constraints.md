# Keys and Constraints

Everything that ties rows together or keeps them valid: foreign keys, indexes and unique constraints, primary keys and CHECK constraints. Single-column versions go on the column (`.references()`, `.unique()`, `.primaryKey()`); everything else goes in `table()`'s third argument, which returns any mix of `index()`, `unique()`, `primaryKey().on()` and `check()`.

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

### Constraint names

By default the constraint is named `<table>_<column>_fk`. Pass `name` when the
constraint already exists in the database under a different one:

```ts
userId: uuid().references(() => users.id, { name: 'orders_user_id_fkey' }),
```

You rarely write this by hand — `kick db introspect` emits it. A database names
its own constraints (Postgres' default is `<table>_<column>_fkey`), and keeping
the real name is what stops the next diff from proposing a rename of every
foreign key in the schema.

For a self-reference, name the column with `selfRef` — the table binds it to its own column:

```ts
import { selfRef } from '@forinda/kickjs-db'

export const categories = table('categories', {
  id: uuid().primaryKey().defaultRandom(),
  parentId: uuid().references(selfRef('id')),
})
```

Written as `() => categories.id`, the const would reference itself in its own initializer, which TypeScript rejects (TS7022) unless the thunk is annotated `(): ColumnRef => categories.id`. `selfRef` needs no annotation, and a column name that doesn't exist fails when the table is declared.

### Typed foreign keys and cycles

`fk(builder, () => target)` is `.references()` that checks both sides hold the same type — a `uuid()` column pointing at a `serial()` key is a type error:

```ts
import { fk } from '@forinda/kickjs-db'

authorId: fk(uuid().notNull(), () => users.id, { onDelete: 'cascade' }),
```

Two tables that reference each other hit the same TS7022 — each const waits on the other. `link()` adds the foreign key once both exist, so neither initializer names the other:

```ts
import { link } from '@forinda/kickjs-db'

export const users = table('users', { id: uuid().primaryKey(), featuredPostId: integer() })
export const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: fk(uuid().notNull(), () => users.id),
})
link(users.featuredPostId, () => posts.id)
```

Tables can also be declared as classes or column by column — see [Table Forms](../db-table-forms.md).

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

### Partial, expression and other indexes

Chain options onto `.on(…)`. A string key is an SQL expression; the other options take SQL or a method name as written:

```ts
import { index, table, text, timestamp, unique, uuid } from '@forinda/kickjs-db'
import { vector } from '@forinda/kickjs-db/pg'

export const users = table(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    bio: text(),
    embedding: vector(1536),
    deletedAt: timestamp(),
  },
  (t) => ({
    // Unique among live rows only: a deleted user's email can be reused.
    emailLive: unique('users_email_live').on(t.email).where('"deletedAt" IS NULL'),
    // An expression key: case-insensitive lookups use it.
    emailLower: unique('users_email_lower').on('lower(email)'),
    // Method and operator class: fuzzy text search, vector similarity.
    bioTrgm: index('users_bio_trgm').on(t.bio).using('gin').op(t.bio, 'gin_trgm_ops'),
    embeddingHnsw: index('users_embedding')
      .on(t.embedding)
      .using('hnsw')
      .op(t.embedding, 'vector_cosine_ops'),
    // Covering index, built without blocking writes.
    emailCover: index('users_email_cover').on(t.email).include(t.id).concurrently(),
  }),
)
```

| Option                | Does                                                        | Postgres | SQLite | MySQL            |
| --------------------- | ----------------------------------------------------------- | -------- | ------ | ---------------- |
| `.on('lower(email)')` | an expression key                                           | yes      | yes    | yes (8.0.13+)    |
| `.where(sql)`         | a partial index over the matching rows                      | yes      | yes    | —                |
| `.using(method)`      | the index method: `gin`, `gist`, `brin`, `hash`, `hnsw`, …  | yes      | —      | `btree` / `hash` |
| `.op(key, opclass)`   | an operator class for one key, like `gin_trgm_ops`          | yes      | —      | —                |
| `.include(...cols)`   | columns stored in the index but not part of its key         | yes      | —      | —                |
| `.concurrently()`     | build and drop with `CONCURRENTLY`, without blocking writes | yes      | —      | —                |

An option the dialect can't express fails as soon as `kick db generate` or `kick db check` reads the schema, before any SQL is written. InnoDB accepts `using('hash')` but builds a B-tree.

- **SQL is passed through.** A `where` or expression names columns as the database knows them, so quote mixed-case names on Postgres (`"deletedAt"`). Extensions an operator class or method needs (`pg_trgm`, `vector`) must exist first: create them in an [empty migration](./migrations.md#empty-migrations).
- **Changing an index rebuilds it.** A changed key, predicate, method, operator class or `include` makes `kick db generate` drop the index and create it again under the same name. Adding or removing `.concurrently()` changes how it's built, not what it is, so it isn't a change.
- **`CONCURRENTLY` gets its own migration.** Postgres can't run it inside a transaction, or next to another statement. So `kick db generate` writes each concurrent index change as a migration of its own, with `"transaction": false` in its `meta.json`, after one holding the rest of the changes. An index on a table created in the same migration is built normally: the table is empty.
- **Introspection** reads expressions, predicates, methods and `INCLUDE` columns back on Postgres, and predicates on SQLite. Operator classes aren't read back. Drift checks compare an index's name, uniqueness and plain columns only, because the database rewrites predicates and expressions in its own form.

### Derived names and the 63-character limit

A single-column `.unique()` or `.references()` derives its constraint name as
`<table>_<column>_unique` / `<table>_<column>_fk`. Postgres caps identifiers at
63 bytes and **truncates silently** rather than erroring, so two derived names
sharing a long prefix would become the same name and the migration would fail
part-way through with `constraint … already exists`.

Derived names that would exceed the limit are shortened deterministically —
truncated, with a short hash of the full name inserted before the `_fk` /
`_unique` marker:

```
finance_vote_head_account_reference_ledgers_fin_a3f19c_fk
```

The hash is taken over the untruncated name, so the result is stable across
regenerations and two names that differ anywhere still differ here. Names within
the limit are untouched, so existing schemas keep the constraint names they
already have. Names you write yourself — in `index()` / `unique()` — are used
exactly as given; keeping them under 63 bytes is up to you.

## Primary keys and CHECK constraints

A single-column key goes on the column — `.primaryKey()`. A composite key, or a key with a name of your choosing, goes in the constraints with `primaryKey(name?).on(...)`, columns in key order:

```ts
import { check, integer, primaryKey, table } from '@forinda/kickjs-db'

export const memberships = table(
  'memberships',
  {
    teamId: integer().notNull(),
    userId: integer().notNull(),
    seats: integer().notNull(),
  },
  (t) => ({
    pk: primaryKey('memberships_pk').on(t.teamId, t.userId),
    seatsPositive: check('seats_positive', 'seats > 0'),
  }),
)
```

- Declare the key one way — `primaryKey()` together with a column's `.primaryKey()` throws.
- Key columns are NOT NULL in the database either way. Mark them `.notNull()` so the row type says so too.
- Only Postgres keeps the key's name (otherwise `<table>_pkey`); MySQL and SQLite ignore it.
- `check(name, expression)` takes SQL as written, for the dialect you target.

Changing the key or a CHECK generates a migration for it — see [Migrations → Primary keys and CHECKs](./migrations#primary-keys-and-checks). The class and fluent [table forms](../db-table-forms.md) take the same constraints.

## Related

- [Schema](./schema) — tables, columns, enums, relations
- [Migrations → Primary keys and CHECKs](./migrations#primary-keys-and-checks)
- [Errors](./errors) — the typed errors these constraints raise
