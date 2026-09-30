---
'@forinda/kickjs-db': major
---

New ways to declare a table, typed foreign keys, and no more annotation for self-references.

**Table forms.** Each builds the same table `table()` would, with identical snapshots and migrations, so they can be mixed in one schema:

- **`tableFromClass(Users)`** reads a class whose fields are column builders (`static readonly tableName = 'users'`). Self-references and cycles need no annotation.
- **`class User extends TableBase('users', { ... }) {}`** makes the class the row type, and it can hold methods (`User.from(row)`). Exporting the class is enough: `kick db generate`, the codec plugin and `createDbClient({ schema })` all find its table.
- **`defineTable('users').column(...).index(...).build()`** declares a table column by column. A repeated column is a type error, and `.column('parentId', (t) => fk(uuid(), () => t.id))` is a typed self-reference.

**Validation rules travel with the table.** `@Rule(...)` on a builder field, `rules` on a `TableBase`, or `.column(key, builder, rule)` are typed against the column: a string rule on an integer column fails to compile. `insertSchema` / `selectSchema` / `updateSchema` apply these rules with no options, and `columns` still overrides them.

**Foreign keys:**

- **`selfRef('id')`** points a foreign key at the table's own column, in `table()` and every form, with no `(): ColumnRef =>` annotation. An unknown column fails when the table is declared.
- **Column refs are typed:** they are now `TypedColumnRef<T>`, which is still assignable to `ColumnRef`, so existing code compiles.
- **`fk(builder, () => target)`** is `.references()` with a type check: a uuid column pointing at a serial key is a type error.
- **`link(column, () => target)`** adds a foreign key after both tables exist, so two tables can reference each other without an annotation.

**Why major:** `TableDecl` gains the non-enumerable `__rules`, `SchemaToTypes` and snapshot extraction also accept a class carrying `static table`, and column refs change type. Code that inspects these shapes may need updating.
