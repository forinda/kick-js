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

|                                   | Object                 | Builder fields    | Base class           | Fluent                                                                      |
| --------------------------------- | ---------------------- | ----------------- | -------------------- | --------------------------------------------------------------------------- |
| Self-reference                    | `selfRef('id')`        | a plain thunk     | `selfRef('id')`      | `.column('parentId', (t) => fk(uuid(), () => t.id))` — key and type checked |
| Two tables referencing each other | `link()`               | plain thunks      | `link()`             | `link()`                                                                    |
| Validation rules                  | `insertSchema` options | `@Rule(...)`      | `rules` option       | `.column(key, builder, rule)`                                               |
| Indexes                           | third argument         | `static indexes`  | `indexes` option     | `.index(...)`                                                               |
| Row objects with methods          | —                      | —                 | `User.from(row)`     | —                                                                           |
| A repeated column name            | object literal error   | class field error | object literal error | type error                                                                  |

- **Builder fields** need no annotation even for a table that references itself or a pair that reference each other: the class body breaks the inference cycle that `table()` hits.
- **Base class**: export the class — `kick db generate` and `createDbClient({ schema })` find its table. `User.table` is the table itself, for `relations()` and `insertSchema`.
- **Fluent** checks the most: a self-reference names a column declared above it with the right type, and a column declared twice fails to compile.

## Validation rules travel with the table

A rule declared with the table fits its column's type — `@Rule({ minLength: 2 })` on an integer column is a type error — and [`insertSchema`](./db-table-schemas.md) applies it with no options:

```ts
export const createUser = insertSchema(usersFluent, { omit: ['id'] })
createUser.safeParse({ email: 'nope' }) // fails: not an email
```

`insertSchema(usersFluent, { columns: { email: { ... } } })` still overrides one.

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

`fk(builder, () => target)` is `.references()` that checks both sides hold the same type, in every form. `link(column, () => target)` adds a foreign key after both tables exist — how two tables reference each other without an annotation. `selfRef('column')` points a foreign key at the table's own column. See [Schema → Foreign keys](./database/constraints.md#foreign-keys).

## Related

- [Schema](./database/schema.md)
- [Schema Types](./db-schema-types.md)
- [Validation from Tables](./db-table-schemas.md)
