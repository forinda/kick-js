---
'@forinda/kickjs-db': patch
---

Preserve `.notNull()` / `.primaryKey()` / `.default()` brands through `.array()`. Previously `integer().notNull().array()` silently dropped the NOT NULL marker, so `SchemaToTypes` emitted `number[] | null` for a NOT NULL column (and `.default(...).array()` lost the `Generated<T>` insert-optionality wrapper). Brand-last chains (`.array().notNull()`) were and remain correct.
