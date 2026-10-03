---
description: Postgres row-level security with kick/db — policies and roles declared next to the table, migrated, and enforced per request with transaction settings.
---

# Row-Level Security

Row-level security (RLS) makes Postgres filter rows itself: a query sees, and can write, only the rows a policy allows, however it was written. kick/db declares policies next to the table, migrates them, and gives each transaction the identity the policies check. Postgres only.

## Declare policies

```ts
import { integer, serial, table, text } from '@forinda/kickjs-db'
import { pgRole, policy } from '@forinda/kickjs-db/pg'

const currentUser = `nullif(current_setting('app.user_id', true), '')::int`

export const support = pgRole('support')

export const docs = table(
  'docs',
  { id: serial().primaryKey(), ownerId: integer().notNull(), body: text() },
  {
    rls: { force: true },
    constraints: () => ({
      own: policy('docs_own')
        .using(`"ownerId" = ${currentUser}`) // which rows it can see, update, delete
        .withCheck(`"ownerId" = ${currentUser}`), // which rows it can write
      supportReads: policy('docs_support_read').for('select').to(support).using('true'),
    }),
  },
)
```

- **A policy turns RLS on for its table.** `rls: true` turns it on with no policy, so no row is visible to anyone the policies don't cover.
- **`rls: { force: true }`** applies the policies to the table's owner too. Your app usually connects as the owner, and without `force` the owner bypasses RLS entirely. Superusers always bypass it.
- **`policy(name)`** options:
  - `.for('select' | 'insert' | 'update' | 'delete' | 'all')`, default `all`.
  - `.to(...roles)`, default `public` (everyone).
  - `.as('restrictive')` for a policy every row must also pass. The default is permissive, where passing any one policy is enough.
  - `.using(sql)` and `.withCheck(sql)`, as SQL expressions.
- **Roles** from `pgRole(name, { login?, createDb?, createRole?, inherit?, bypassRls? })` are created by migrations if they're missing. Roles are shared by every database on the server, so a migration never drops one, and a down migration leaves it. `pgRole(name).existing()` refers to a role managed elsewhere. Passwords and `GRANT`s stay outside the schema.

## Give each request its identity

The policies read `current_setting('app.user_id')`. Set it for the transaction that does a request's work:

```ts
await db.transaction({ settings: { 'app.user_id': ctx.user.id } }, async (tx) => {
  return tx.selectFrom('docs').selectAll().execute() // only this user's docs
})
```

- **`settings`** runs `set_config(key, value, true)` for that transaction only, so it's safe with a connection pool: the next transaction on the connection starts clean. Values are bound parameters, and keys need a dot (`app.user_id`).
- **`role`** runs `SET LOCAL ROLE`, so policies `TO` that role apply: `db.transaction({ role: 'support' }, fn)`. The connection's role must be a member of it.
- Both are refused inside an already-open transaction, where they'd change it for everything else in it. Use `nested: 'separate'` for a separate one.

A [context contributor](../context-decorators.md) or a service method that wraps the request's work in that transaction keeps it in one place.

## Things Postgres does that surprise people

- **`''`, not NULL.** Once a custom setting has been set on a connection, reading it after the transaction ends returns `''`. `''::int` throws, hence the `nullif(…, '')` above. A query with no user then sees nothing instead of failing.
- **Members inherit policies.** A policy `TO support` applies to every role that is a member of `support`. If your app role should only switch to it with `SET ROLE`, grant it `WITH INHERIT FALSE` (Postgres 16+).
- **Table privileges are separate.** A role still needs `GRANT SELECT ON docs TO support` to touch the table; policies only narrow which rows.

## Migrations

- **Order:** roles are created first, then tables, with RLS and policies after everything else. A changed policy is dropped and re-created.
- **Column changes:** Postgres won't alter or drop a column a policy uses, so a migration that changes a table drops its policies first and re-creates them after. The same applies to policies whose SQL names another table that changes.
- **Introspection** reads RLS and policies back (`kick db introspect` renders them). Drift compares policies by name, command, kind and roles, not their SQL, which Postgres rewrites.
