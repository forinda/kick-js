---
'@forinda/kickjs-db': patch
---

Relational reads and query plugins that returned wrong rows or failed:

- A soft-deleted junction row no longer links a many-to-many pair (`withDeleted` on the level includes it).
- A many-to-many level's `where` on a column the junction also has (`id`) is no longer ambiguous: the junction is matched with `EXISTS`, out of the level's scope.
- `offset` without `limit` works on SQLite and MySQL, at the top and nested (they have no OFFSET on its own).
- A nested `bytea` column on SQLite, which its JSON can't hold, is refused by name with how to leave it out, instead of `JSON cannot hold BLOB values`.
- A relation named like an `Object.prototype` member (`constructor`) no longer reads as a column collision, and `with: { toString: true }` is an unknown relation, not a `TypeError`.
- Managed columns (`onUpdateNow()`, `version()`, `$onUpdate`, insert defaults) are set on an insert or update inside a `WITH` too.
- `$extends({ result })` on a select with joins no longer adds its `needs` columns (an unqualified one was ambiguous), and computes a field only when the row has every column it needs.
- `$extends({ result })` works under `casing: 'snake_case'` and with `.colName()` columns: a table named in camelCase (`blogPosts`) got no computed fields, and a needed column was added by its key (`no such column: "passwordHash"`). It's now found by its key and added by its database name.

- A `morphTo` subject gets its table's computed fields when the type column holds numbers, and on SQLite leaves its `bytea` columns out instead of failing; computed fields apply to a table in a named schema (`billing.invoices`).

Behaviour changes: a many-to-many level now returns each related row once even if the junction links the pair twice (the junction is matched with `EXISTS`); a computed field on a select with joins is left off a row that lacks the columns it needs, instead of computing from `undefined`.
