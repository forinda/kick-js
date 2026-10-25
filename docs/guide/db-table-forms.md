# Table Forms

`table('users', { ... })` is one way to declare a table. kick/db has three more — builder fields, a base class, and a fluent builder. Each hands the same column builders to `table()`, so what comes out is an ordinary table: the snapshot, and so every migration, is identical; the query client, [relations](./database/schema.md#relations-for-db-query) and [Validation from Tables](./db-table-schemas.md) can't tell which form declared it.

Pick the one that reads best for a table. Mixing forms in one schema is fine.

## The four forms

```ts
import {
  TableBase,
  defineTable,
  table,
  tableFromClass,
  uuid,
  varchar,
  Rule,
} from '@forinda/kickjs-db'

// Object — the default
export const usersObject = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(120).notNull(),
})

// Builder fields — a class whose fields are the builders
class Users {
  static readonly tableName = 'users'
  id = uuid().primaryKey().defaultRandom()
  @Rule({ format: 'email' }) email = varchar(120).notNull()
}
export const usersFromFields = tableFromClass(Users)

// Base class — the class is the row type, and can hold methods
export class User extends TableBase(
  'users',
  { id: uuid().primaryKey().defaultRandom(), email: varchar(120).notNull() },
  { rules: { email: { format: 'email' } } },
) {
  get domain() {
    return this.email.split('@')[1]
  }
}

// Fluent — column by column
export const usersFluent = defineTable('users')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('email', varchar(120).notNull(), { format: 'email' })
  .build()
```

All four declare the same `users` table — one file shows them side by side here; a real schema declares each table once, in whichever form. They give the same row types, the same literal table name to the typed client (`db.selectFrom('users')`), and typed column refs.

## Where they differ

|                                   | Object                                             | Builder fields    | Base class                                         | Fluent                                                                      |
| --------------------------------- | -------------------------------------------------- | ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Self-reference                    | `fk(uuid(), selfRef('id'))` — key and type checked | a plain thunk     | `fk(uuid(), selfRef('id'))` — key and type checked | `.column('parentId', (t) => fk(uuid(), () => t.id))` — key and type checked |
| Two tables referencing each other | `link()`                                           | plain thunks      | `link()`                                           | `link()`                                                                    |
| Validation rules                  | `insertSchema` options                             | `@Rule(...)`      | `rules` option                                     | `.column(key, builder, rule)`                                               |
| Indexes                           | third argument                                     | `static indexes`  | `indexes` option                                   | `.index(...)`                                                               |
| Row objects with methods          | —                                                  | —                 | `User.from(row)`                                   | —                                                                           |
| A repeated column name            | object literal error                               | class field error | object literal error                               | type error                                                                  |

- **Builder fields** need no annotation even for a table that references itself or a pair that reference each other: the class body breaks the inference cycle that `table()` hits.
- **Base class**: export the class — `kick db generate` and `createDbClient({ schema })` find its table. `User.table` is the table itself, for `relations()` and `insertSchema`.
- **Fluent** checks the most: a self-reference names a column declared above it with the right type, and a column declared twice fails to compile. The object and base-class forms check a self-reference written `fk(builder, selfRef('id'))` the same way.

## Validation rules travel with the table

A rule declared with the table fits its column's type — `@Rule({ minLength: 2 })` on an integer column is a type error — and [`insertSchema`](./db-table-schemas.md) applies it with no options:

```ts
export const createUser = insertSchema(usersFluent, { omit: ['id'] })
createUser.safeParse({ email: 'nope' }) // fails: not an email
```

`insertSchema(usersFluent, { columns: { email: { ... } } })` still overrides one.

## Derived fields

A value computed from other columns — a `fullName` from `firstName` and `lastName` — can live in three places:

|                                | Getter on a base class   | Result extension                                                                  | Generated column                            |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------- |
| Computed                       | in TypeScript, on access | in TypeScript, after each select                                                  | by the database                             |
| On rows a query returns        | after `Person.from(row)` | single-table selects and `db.query`; with joins, when the row has what it `needs` | yes — it's a column                         |
| `where` / `orderBy` / an index | no                       | no                                                                                | yes (on Postgres, an index needs it stored) |
| Migration                      | none                     | none                                                                              | yes                                         |

**Getter** — methods and getters on a [base-class](#the-four-forms) table. Queries return plain objects, so turn a row into an instance first:

```ts
export class Person extends TableBase('people', {
  id: serial().primaryKey(),
  firstName: text().notNull(),
  lastName: text(),
}) {
  get fullName() {
    return [this.firstName, this.lastName].filter(Boolean).join(' ')
  }
}

const people = (await db.selectFrom('people').selectAll().execute()).map((r) => Person.from(r))
people[0].fullName // 'Ada Lovelace'
```

**Result extension** — the field arrives on the rows a select returns, typed, with no `from()`. On a single-table select or `db.query`, the columns it `needs` are fetched even when the select leaves them out:

```ts
export const db = createDbClient({ schema, dialect }).$extends({
  result: {
    people: {
      fullName: {
        needs: { firstName: true, lastName: true },
        compute: (r) => [r.firstName, r.lastName].filter(Boolean).join(' '),
      },
    },
  },
})

const rows = await db.selectFrom('people').select(['id']).execute()
rows[0].fullName // 'Ada Lovelace'
```

`compute` is synchronous. A select with joins doesn't fetch what the field `needs`, so it's filled only when the row already has those columns, and left off otherwise. [Extensions](./db-extensions.md#result-extensions) has the details.

**Generated column** — the database computes it, stored on write or (`{ stored: false }`) on read, so you can filter, sort and index by it — on Postgres, only a stored one can be indexed. It's a column like any other in every form, read-only on insert and update:

```ts
fullName: text().generatedAlwaysAs(`"firstName" || coalesce(' ' || "lastName", '')`),
```

The SQL is your dialect's and names the columns as the database does — quoted here, since the keys are mixed-case. [Generated columns](./database/schema.md#generated-columns) has the MySQL form and the Postgres rules.

Display only: a getter or a result extension. Searched, sorted or indexed: a generated column.

## Postgres schemas

A table in a named Postgres schema — `pgSchema('billing').table(...)` — in each form:

```ts
class Invoices {
  static readonly tableName = 'invoices'
  static readonly schema = 'billing'
  id = uuid().primaryKey()
}

class Invoice extends TableBase('invoices', { id: uuid().primaryKey() }, { schema: 'billing' }) {}

defineTable('invoices', { schema: 'billing' }).column('id', uuid().primaryKey()).build()
```

The typed client keys it `'billing.invoices'`, as with `pgSchema`.

## Foreign keys

`fk(builder, () => target)` is `.references()` that checks both sides hold the same type, in every form. `link(column, () => target)` adds a foreign key after both tables exist — how two tables reference each other without an annotation. `selfRef('column')` points a foreign key at the table's own column; inside `fk()` the column's name and type are checked. See [Schema → Foreign keys](./database/constraints.md#foreign-keys).

## Related

- [Schema](./database/schema.md)
- [Schema Types](./db-schema-types.md)
- [Validation from Tables](./db-table-schemas.md)
