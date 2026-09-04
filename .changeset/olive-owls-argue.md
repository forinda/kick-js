---
'@forinda/kickjs-db': minor
---

`kick db introspect` now reads Postgres enum types (#644).

Enum columns were introspected as their type name and then rendered as
`text(/* TODO: enum_x */)`, and the types themselves were never read at all — so
a schema regenerated from a database with 36 enum types had 37 columns of the
wrong type and none of the types. The information was read and discarded.

`introspectPg` now returns the enum types in `SchemaSnapshot.enums`, preserving
value order (which for an enum is part of the type — comparisons and `ORDER BY`
follow it), and the renderer emits a `pgEnum(...)` declaration per type and
calls the factory for each column. `enums` is omitted entirely when the database
declares none, so existing snapshots are byte-identical.

The `pgEnum` builder and the `CREATE TYPE` emit path already shipped; this
connects introspect to them.

Also fixes the enum default in the schema guide: `.default('todo')`, not
`.default("'todo'")` — the emitter quotes the value, and pre-quoting produced
`DEFAULT '''todo'''`.
