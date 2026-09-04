---
'@forinda/kickjs-db': patch
---

Fix `kick db introspect` dropping every foreign key from a real database (#643).

The renderer inlined a foreign key onto its column only when the constraint's
name matched `<table>_<column>_fk` — the name this DSL derives. A database names
its own constraints: Postgres' default is `<table>_<column>_fkey`, and a DBA may
have chosen anything. So introspecting a live schema matched nothing and every
key fell through to a TODO comment — 1,330 of them on a 242-table schema.

Foreign keys are now matched on shape (one column, this column) rather than by
name, and `.references()` takes a `name` option so the real constraint name
survives the round-trip instead of the next diff proposing a rename of every
key. Composite keys still render as TODO comments — the column DSL has no form
for them.
