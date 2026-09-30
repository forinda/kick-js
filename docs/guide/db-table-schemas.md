# Validation from Tables

A kick/db table already says what a row holds. `insertSchema`, `selectSchema` and `updateSchema` turn it into the schema a route validates with — so the table is the one place a column's type is written, and request validation, the OpenAPI spec, `ctx.body`'s type and the typed client all follow it.

```ts
// src/modules/notes/notes.table.ts
import { table, uuid, varchar, text, integer, timestamptz } from '@forinda/kickjs-db'
import { insertSchema, selectSchema, updateSchema } from '@forinda/kickjs-db/schema'

export const notes = table('notes', {
  id: uuid().primaryKey().defaultRandom(),
  title: varchar(80).notNull(),
  body: text(),
  stars: integer().notNull().default(0),
  createdAt: timestamptz().notNull().defaultNow(),
})

export const createNote = insertSchema(notes, {
  columns: { title: { minLength: 3 } },
  omit: ['id', 'createdAt'],
})
export const updateNote = updateSchema(notes, { omit: ['id', 'createdAt'] })
export const noteRow = selectSchema(notes)
```

```ts
@Post('/', { body: createNote })
create(ctx: Ctx<KickRoutes.NotesController['create']>) {
  ctx.body.title // string
  ctx.body.stars // number | undefined — the database has a default
}
```

- A body that doesn't match gets a `422`, as with any route schema.
- Swagger documents the body from the same schema: `title` is a string of 3–80 characters, `body` is nullable, only `title` is required.
- `kick typegen` types `ctx.body` from it, and the [typed client](./typed-client.md) sends the same shape.

Export the schema as a `const` and pass it by name — typegen reads the name, not an inline call.

## The three schemas

|                | Every column                          | Optional                                                             | `null` allowed   |
| -------------- | ------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| `selectSchema` | required                              | —                                                                    | nullable columns |
| `insertSchema` | required unless the database fills it | serial, `.default(...)`, `defaultNow()`, `defaultRandom()`, nullable | nullable columns |
| `updateSchema` | —                                     | all                                                                  | nullable columns |

`omit` leaves columns out entirely — ids and timestamps the client shouldn't send, or `password` on a read. Keys that aren't columns are dropped from the parsed value.

## What each column type accepts

| Column                                          | Accepts                                                                              | Parsed to        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| `integer`, `smallint`, `serial`                 | an integer the column can store (`smallint` ±32767, `integer` ±2³¹, `serial` from 1) | `number`         |
| `bigint`, `bigSerial`                           | a 64-bit integer, as a number or a string of digits (JSON has no 64-bit integer)     | `bigint`         |
| `real`, `doublePrecision`                       | a number                                                                             | `number`         |
| `decimal`, `numeric`, `money`                   | a number or a decimal string                                                         | `string` (exact) |
| `varchar(n)`, `char(n)`                         | a string of at most `n` characters                                                   | `string`         |
| `text`, `citext`, `time`, `interval`, `inet`, … | a string                                                                             | `string`         |
| `boolean`                                       | a boolean                                                                            | `boolean`        |
| `timestamp`, `timestamptz`, `date`              | an ISO string or a `Date`                                                            | `Date`           |
| `uuid`                                          | a UUID string                                                                        | `string`         |
| `pgEnum(...)`                                   | one of its values                                                                    | `string`         |
| `vector(n)`                                     | `n` numbers                                                                          | `number[]`       |
| `.array()`                                      | an array of the element type                                                         | array            |
| `json`, `jsonb`, `customType`                   | anything — add a schema (below)                                                      | as given         |

## Adding what a table can't say

A column type doesn't know a string is an email, or what shape a `jsonb` column holds. `columns` adds it, per column:

```ts
import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'

export const createUser = insertSchema(users, {
  columns: {
    email: { format: 'email' },
    name: { minLength: 1, maxLength: 60 },
    age: { minimum: 0 },
    handle: { pattern: '[a-z0-9_]+' },
    // A whole schema replaces the column's rule — the way to type a json column.
    prefs: fromZod(z.object({ theme: z.enum(['light', 'dark']) })),
  },
})
```

A rule takes `format` (`email`, `uri`, `uuid` and `date-time` are checked), `minLength`, `maxLength`, `pattern`, `minimum` and `maximum`, and they appear in the OpenAPI output too.

## Rules declared with the table

A table declared with one of the [table forms](./db-table-forms.md) can carry its rules — `@Rule(...)` on a builder field, `rules` on a `TableBase`, the third argument of `defineTable().column()`. `insertSchema` / `selectSchema` / `updateSchema` apply them with no options; `columns` still overrides one.

```ts
export const users = defineTable('users')
  .column('id', uuid().primaryKey().defaultRandom())
  .column('email', varchar(120).notNull(), { format: 'email' })
  .build()

export const createUser = insertSchema(users, { omit: ['id'] }) // email checked as an email
```

## Row types

```ts
import type { InferInsert, InferSelect } from '@forinda/kickjs-db/schema'

type Note = InferSelect<typeof notes> // { id: string; title: string; body: string | null; … }
type NewNote = InferInsert<typeof notes> // id, body, stars, createdAt optional
```

## Beyond KickJS

Each schema is also a [Standard Schema](https://standardschema.dev) (`schema['~standard']`), so libraries that accept those take it as-is.

## Related

- [Validation](./validation.md) — route schemas in general
- [DB Schema Types](./db-schema-types.md) — how the row types are inferred
- [Swagger](./swagger.md)
