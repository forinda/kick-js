---
'@forinda/kickjs-db': minor
'@forinda/kickjs-cli': minor
---

The kick/db typegen plugin now emits a `KickDbRelationsRegister` augmentation alongside the existing `KickDbSchema` + `KickDbRegister`, so `db.query.X.findMany({ with })` call sites get typed `with` keys without a hand-rolled augmentation file.

After upgrading + running `kick typegen` (or `kick dev`), `.kickjs/types/kick__db.d.ts` carries:

```ts
declare module '@forinda/kickjs-db' {
  interface KickDbRegister {
    db: KickDbClient<KickDbSchema>
  }

  interface KickDbRelationsRegister {
    db: SchemaToRelationsRegister<typeof appSchema>
  }
}
```

`SchemaToRelationsRegister<S>` is a new public type-level helper exported from `@forinda/kickjs-db`. It walks the schema barrel for `relations()` declarations and folds them into the registry shape — keyed by source table, each entry mapping `relationName → { kind, target }` with the target shrunk to the literal table name. Adding or removing a relation in `src/db/schema/relations.ts` flows through to call-site type-checking automatically.

**Type-only refactor on `relations()`:**

`relations(source, builder)` and the `Helpers.one` / `Helpers.many` factories now preserve the source name and target literal at the type level. The runtime shape is unchanged and all existing call sites remain assignable to the prior less-specific signature; this is strictly a narrowing improvement that makes `SchemaToRelationsRegister<S>` derivable.

Specifically:

- `relations()` returns `RelationsDecl<TSourceName, TRelationsMap>` (was `RelationsDecl`).
- `Helpers.one` returns `RelationOne<TTarget>` (was `RelationOne`).
- `Helpers.many` returns `RelationMany<TTarget>` (was `RelationMany`).

Adopters who match against the old return types via `extends RelationsDecl` keep working — both new generics default to the prior open shape.

**Migration:** Adopters who hand-rolled `KickDbRelationsRegister` augmentations as a stop-gap (suggested in M3.A.5 docs) can delete those files once typegen runs. The auto-emitted shape matches what was hand-written.
