# DB Extensions

Two extension surfaces let adopters tailor `@forinda/kickjs-db` to their project without forking:

- **`customType<T>()`** — declare a typed column the built-in DSL doesn't ship (encrypted strings, opaque IDs, citext, geometry, custom JSON shapes).
- **`db.$extends({ model })`** — add per-table methods directly on the client (`db.users.findByEmail(...)`).

## `customType<T>()`

```ts
import { customType, table, serial } from '@forinda/kickjs-db'

type EncryptedString = string & { readonly __brand: 'EncryptedString' }

export const encrypted = customType<EncryptedString>({
  dataType: () => 'text',
  toDriver: (s) => encryptSync(s),
  fromDriver: (raw) => decryptSync(String(raw)) as EncryptedString,
})

export const secrets = table('secrets', {
  id: serial().primaryKey(),
  value: encrypted().notNull(),
})
```

The phantom `T` flows through `SchemaToKysely<typeof schema>`:

```ts
db.selectFrom('secrets').select('value')
//   row.value: EncryptedString — branded, not plain `string`
```

### What `dataType` does

Returned as a thunk so adopters can compute the SQL type from runtime config (dialect-specific overrides, configurable lengths). The string is the SQL declaration as it would appear in `CREATE TABLE` — `'text'`, `'jsonb'`, `'citext'`, `'geometry(Point, 4326)'`, etc.

### `fromDriver` — auto-decode on select

Wired today. The kick/db Kysely plugin walks selected rows, looks up each column name in the decoder map, and applies `fromDriver(rawValue)` per match. `null` and `undefined` pass through untouched so codecs don't have to handle the nullable case themselves.

```ts
const row = await db.selectFrom('secrets').selectAll().where('id', '=', 1).executeTakeFirst()
// row?.value is already the decrypted EncryptedString — no manual mapping
```

### `toDriver` — encode on insert

Stored on the column builder but **not yet auto-applied at insert time**. The Kysely OperationNodeTransformer pass that walks `InsertQueryNode` + `UpdateQueryNode` lands as a follow-up. Until then, apply `toDriver` manually before passing to `.values()`:

```ts
await db
  .insertInto('secrets')
  .values({
    value: encrypted.toDriver?.(plaintext as EncryptedString) as EncryptedString,
  })
  .execute()
```

::: tip Defer if encoding is symmetric
For codecs where `toDriver` is identity (logging tags, branded IDs) you can skip the manual call — the brand stays in the type system, the value passes through untouched.
:::

## `db.$extends({ model })`

Repository-style methods directly on the client, organised by table:

```ts
const dbX = db.$extends({
  model: {
    users: {
      async findByEmail(this: typeof dbX, email: string) {
        return this.selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst()
      },

      async createWithDefaults(this: typeof dbX, input: { email: string; name: string }) {
        return this.insertInto('users')
          .values({ ...input, isActive: true })
          .returningAll()
          .executeTakeFirstOrThrow()
      },
    },

    posts: {
      async byAuthor(this: typeof dbX, authorId: string) {
        return this.selectFrom('posts').selectAll().where('authorId', '=', authorId).execute()
      },
    },
  },
})

await dbX.users.findByEmail('a@b.com')
await dbX.posts.byAuthor('user-id-here')
```

### `this` binding

Inside each method, `this` is the extended client itself — `this.selectFrom`, `this.transaction`, `this.kysely` all resolve. Methods can also call sibling tables:

```ts
const dbX = db.$extends({
  model: {
    users: {
      async createWithProfile(this: typeof dbX, input: NewUser) {
        return this.transaction(async (tx) => {
          const user = await tx.insertInto('users').values(input).returningAll().executeTakeFirstOrThrow()
          await tx.posts.createDefaultWelcome(user.id)   // ← sibling table call
          return user
        })
      },
    },
    posts: {
      async createDefaultWelcome(this: typeof dbX, authorId: string) {
        await this.insertInto('posts').values({ authorId, title: 'Welcome', body: '...' }).execute()
      },
    },
  },
})
```

::: tip Annotate `this` for full TS support
TypeScript needs the `this: typeof dbX` annotation inside method bodies for `this.selectFrom` to resolve. Self-typed inference (no annotation needed) is on the roadmap; until then the explicit `this` is the canonical pattern.
:::

### Chaining

Each `$extends` call returns a fresh proxy. Stacking calls **does not** carry forward earlier methods:

```ts
const dbA = db.$extends({ model: { users: { a: () => 'A' } } })
const dbB = dbA.$extends({ model: { users: { b: () => 'B' } } })

dbB.users.b() // ✓ 'B'
dbB.users.a   // ✗ undefined — stage A's bag isn't merged forward
dbA.users.a() // ✓ 'A' on the original layer
```

Compose the full extension object up-front rather than chaining:

```ts
const dbX = db.$extends({
  model: {
    users: { a: () => 'A', b: () => 'B' },
  },
})
```

If you genuinely need staged composition (e.g. a base layer + project-specific add-ons), spread the model bags manually:

```ts
const baseUsers = { findByEmail() { /* ... */ } }
const dbX = db.$extends({
  model: {
    users: { ...baseUsers, projectSpecific() { /* ... */ } },
  },
})
```

### Result extensions (deferred)

The plan reserves a `result` field for `compute()` extensions that add derived properties to selected rows:

```ts
// roadmap — NOT shipped in v1
db.$extends({
  result: {
    posts: {
      url: { needs: { id: true, slug: true }, compute: (row) => `/posts/${row.id}/${row.slug}` },
    },
  },
})
```

This needs an `OperationNodeTransformer` Kysely plugin that walks `SelectQueryNode` (to ensure `needs` columns are included) plus `transformResult` (to apply `compute()` per row). It ships alongside the `toDriver` insert pass, since both share the same plumbing.

For now, derive computed fields client-side or via Kysely's `.select()` callback:

```ts
const posts = await db
  .selectFrom('posts')
  .selectAll()
  .execute()
  .then((rows) => rows.map((r) => ({ ...r, url: `/posts/${r.id}/${r.slug}` })))
```

## DI integration

Both extensions stay invisible to the DI container — `KickDbClient` (or your extended `typeof dbX`) injects the same way:

```ts
@Service()
export class UsersService {
  constructor(@Inject(DB_PRIMARY) private readonly db: typeof dbX) {}

  async login(email: string) {
    return this.db.users.findByEmail(email)
  }
}
```

Register the extended client under `DB_PRIMARY` instead of the bare one:

```ts
// src/index.ts
const dbX = dbClient.$extends({ model: { /* ... */ } })

Container.getInstance().registerFactory(DB_PRIMARY, () => dbX)
```

Update `KickDbRegister` to widen `KickDbClient` to the extended shape:

```ts
declare module '@forinda/kickjs-db' {
  interface KickDbRegister {
    db: typeof dbX
  }
}
```
