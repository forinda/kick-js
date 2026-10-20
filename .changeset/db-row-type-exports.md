---
'@forinda/kickjs-db': minor
---

Row types: `InferUpdate<typeof table>` (from `@forinda/kickjs-db/schema`) joins `InferSelect` and `InferInsert` — every writable column optional, the shape `updateSchema()` checks. `@forinda/kickjs-db` also re-exports Kysely's `Selectable`, `Insertable` and `Updateable`, for table types taken from the client's `DB` (`Selectable<RegisteredDB['notes']>`) without installing Kysely separately.
