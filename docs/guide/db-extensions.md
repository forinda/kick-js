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

The phantom `T` flows through `SchemaToTypes<typeof schema>`:

```ts
db.selectFrom('secrets').select('value')
//   row.value: EncryptedString — branded, not plain `string`
```

### What `dataType` does

Returned as a thunk so adopters can compute the SQL type from runtime config (dialect-specific overrides, configurable lengths). The string is the SQL declaration as it would appear in `CREATE TABLE` — `'text'`, `'jsonb'`, `'citext'`, `'geometry(Point, 4326)'`, etc.

### `fromDriver` — auto-decode on select

Wired today. The kick/db query layer walks selected rows, looks up each column name in the decoder map, and applies `fromDriver(rawValue)` per match. `null` and `undefined` pass through untouched so codecs don't have to handle the nullable case themselves.

```ts
const row = await db.selectFrom('secrets').selectAll().where('id', '=', 1).executeTakeFirst()
// row?.value is already the decrypted EncryptedString — no manual mapping
```

### `toDriver` — encode on insert + update

Wired today. The kick/db query layer walks `INSERT` and `UPDATE` statements at compile time — every value targeting a column with a `toDriver` codec is encoded before the driver sees it. Pass plain branded values straight to `.values()` / `.set()`:

```ts
await db
  .insertInto('secrets')
  .values({ value: plaintext as EncryptedString })
  .execute()

await db
  .updateTable('secrets')
  .set({ value: rotated as EncryptedString })
  .where('id', '=', 1)
  .execute()
```

`null` and `undefined` pass through untouched so codecs don't need to handle the nullable case.

::: tip Insert from `SELECT`
`db.insertInto('a').expression(db.selectFrom('b'))` skips the encoder pass — values come from a sub-select, not literals on this side. If the source rows aren't already encoded, run a one-shot transform via the query builder or precompute the encoded column before insert.
:::

## `db.$extends({ model })`

Repository-style methods directly on the client, organised by table:

```ts
const dbX = db.$extends({
  model: {
    users: {
      async findByEmail(email: string) {
        const self = this as unknown as typeof db
        return self.selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst()
      },

      async createWithDefaults(input: { email: string; name: string }) {
        const self = this as unknown as typeof db
        return self.insertInto('users')
          .values({ ...input, isActive: true })
          .returningAll()
          .executeTakeFirstOrThrow()
      },
    },

    posts: {
      async byAuthor(authorId: string) {
        const self = this as unknown as typeof db
        return self.selectFrom('posts').selectAll().where('authorId', '=', authorId).execute()
      },
    },
  },
})

await dbX.users.findByEmail('a@b.com')
await dbX.posts.byAuthor('user-id-here')
```

### `this` binding

`applyExtensions` rebinds every method via `Function.prototype.call` so `this` points at the extended proxy at runtime — `this.selectFrom`, `this.transaction`, `this.qb`, and sibling table methods (`this.posts.label()`) all resolve when the call fires.

TypeScript can't model the rebinding directly. Each method on the model bag is type-checked against the surrounding record (the `users` literal or the `posts` literal), not the eventual proxy. Annotating the method with `this: typeof dbX` self-references the const we're declaring; `this: typeof db` (the unextended client) is rejected because the bag's record shape isn't assignable to the client.

The reliable pattern is to **cast `this` inside the method body**:

```ts
const dbX = db.$extends({
  model: {
    users: {
      async createWithProfile(input: NewUser) {
        const self = this as unknown as typeof db
        return self.transaction(async (tx) => {
          const user = await tx
            .insertInto('users')
            .values(input)
            .returningAll()
            .executeTakeFirstOrThrow()
          // tx.posts.createDefaultWelcome(user.id) works at runtime —
          // declare a structural shape if you want it typed:
          //   const txX = tx as unknown as { posts: { createDefaultWelcome(id: string): Promise<void> } }
          //   await txX.posts.createDefaultWelcome(user.id)
          return user
        })
      },
    },
    posts: {
      async createDefaultWelcome(authorId: string) {
        const self = this as unknown as typeof db
        await self.insertInto('posts').values({ authorId, title: 'Welcome', body: '...' }).execute()
      },
    },
  },
})
```

::: tip Self-typed inference is on the roadmap
A future release will widen the `ModelExtensions<DB>` type so methods can declare `this: ExtendedClient` without the self-reference. Until then, the cast inside the body is the canonical workaround.
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

This needs a query-tree transform that walks select statements (to ensure `needs` columns are included) plus a result transform (to apply `compute()` per row). It ships alongside the `toDriver` insert pass since both share the same plumbing.

For now, derive computed fields client-side or via the query builder's `.select()` callback:

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
