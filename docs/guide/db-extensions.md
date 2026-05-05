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
        return self.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
      },

      async createWithDefaults(input: { email: string; name: string }) {
        const self = this as unknown as typeof db
        return self
          .insertInto('users')
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
dbB.users.a // ✗ undefined — stage A's bag isn't merged forward
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
const baseUsers = {
  findByEmail() {
    /* ... */
  },
}
const dbX = db.$extends({
  model: {
    users: {
      ...baseUsers,
      projectSpecific() {
        /* ... */
      },
    },
  },
})
```

### Result extensions

Add derived properties to every selected row of a table. Each computed declares which columns it `needs` and a `compute(row)` function that produces the value. A query-tree transform rewrites the query before SQL emit so the listed columns are fetched whenever that table is selected:

```ts
const dbX = db.$extends({
  result: {
    posts: {
      url: { needs: { id: true, slug: true }, compute: (row) => `/posts/${row.id}/${row.slug}` },
      excerpt: { needs: { body: true }, compute: (row) => row.body.slice(0, 140) },
    },
  },
})

const rows = await dbX.selectFrom('posts').selectAll().execute()
//    rows[0].url:     string  — typed, computed from id + slug
//    rows[0].excerpt: string  — typed, computed from body
```

**`needs` injection** — the plugin only rewrites the **top-level** `SelectQueryNode`, and only when its `from` resolves to a single table with computeds. In that case it adds any declared `needs` column not already in the select list. Adopters who write `.select(['title'])` still get the computeds populated. Joins, sub-selects, and multi-table `FROM` clauses are skipped entirely — as are nested `SelectQueryNode`s inside `WITH` / `UNION` / scalar sub-selects. The injected columns DO land on the runtime row object (they were fetched, after all) — the row's TypeScript shape only widens with the computed property itself, but a property-existence check at runtime would still find the needs columns. Wildcards (`selectAll()`) skip injection entirely — every column is implicitly present.

**`compute()` semantics**

- Sync only in v1 — async opens up "runtime queries inside compute" footguns. Use a model method when you need to query.
- Each row is computed independently; computeds on the same table all run per row.
- A throwing `compute()` degrades to `undefined` on that row's property; sibling computeds and rows still complete cleanly.
- Single-table only: joins, sub-selects, multi-table FROM clauses pass through untouched. Cross-table computeds are roadmap.

**How the rebuild works** — `$extends({ result })` registers a query-pipeline plugin that owns the transform pair. The new client shares the original's event emitter, savepoint counter, and dialect tag, so `.transaction()` / `.on('slowQuery', …)` / per-call savepoints keep working transparently. `$extends({ model })` alone (no `result`) skips the rebuild — it stays a thin Proxy as before. Composing both in one call is the common path:

```ts
const dbX = db.$extends({
  model: {
    posts: {
      latest(this: typeof dbX, limit: number) {
        return this.selectFrom('posts').selectAll().limit(limit).execute()
      },
    },
  },
  result: {
    posts: {
      url: { needs: { id: true, slug: true }, compute: (r) => `/posts/${r.id}/${r.slug}` },
    },
  },
})

await dbX.posts.latest(5) // each row carries the computed `url`
```

::: tip Out of scope for v1

- needs columns aren't compile-time validated against the schema — typos surface at runtime when the SELECT executes. Type-level narrowing lands once `SchemaToTypes` exposes the column-name union per table.
- async `compute()` is rejected — keep the post-fetch transform synchronous to bound the cost of every row.
- joined / multi-from selects pass through. Use a model method that hand-writes the JSON-aggregation path for those today.
  :::

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
const dbX = dbClient.$extends({
  model: {
    /* ... */
  },
})

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
