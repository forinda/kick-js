---
'@forinda/kickjs-db': minor
---

Add `relationName: 'foo'` to `relations()` for multi-FK disambiguation. Resolves the drizzle-parity gap where two tables share more than one FK to the same target — `messages.senderId` + `messages.recipientId` both referencing `users.id`, with `users.sentMessages` + `users.receivedMessages` walking back the other way.

After this release, adopters tag matching pairs with the same string:

```ts
relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: 'sentMessages',
  }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: 'receivedMessages',
  }),
}))

relations(users, ({ many }) => ({
  sentMessages: many(messages, { relationName: 'sentMessages' }),
  receivedMessages: many(messages, { relationName: 'receivedMessages' }),
}))
```

The resolver pairs by name first; M3's single-inverse + FK-introspection fallbacks remain for schemas that don't need the disambiguation.

**Resolution precedence** (`extractRelations`):

1. Both sides declare matching `relationName` → use the matched `one`'s columns.
2. Single untagged inverse `one` (no `relationName` on either side, exactly one `one` on the target points back at the source) → use it.
3. FK introspection — exactly one FK back to the source → use those columns.
4. Throw `RelationalQueryMissingInverseError` with a hint to add `relationName`.

**Behavior change vs M3:** Step 2 now requires the inverse to be **unique**. M3's `findInverseOne` returned the first match without a uniqueness check, which silently picked wrong on multi-FK schemas. M4.B makes those schemas surface as `MissingInverseError` instead of silently joining the wrong way. Single-FK schemas (the common case) behave identically.

**New public surface:**

- `Helpers.one`'s opts gain optional `relationName?: string`.
- `Helpers.many`'s second arg becomes optional `{ relationName?: string }` (was required-positional `target` only).
- `RelationOne<T>` + `RelationMany<T>` interfaces gain optional `relationName?: string`.
- `RelationMapEntry` (and the `KickDbRelationsRegister` augmentation it composes) gain optional `relationName?: string`. The kick/db typegen plugin auto-emits the new field through `SchemaToRelationsRegister<S>` — no plugin update needed.
- `RelationSnapshot` (`SchemaSnapshot.relations[*][*]`) gains optional `relationName?: string` for adopters reading the snapshot programmatically.
- New error class `RelationalQueryAmbiguousRelationNameError` — thrown when two `one` declarations on the same target share a `relationName` AND point back at the same source. Scope: `(sourceTable, targetTable, relationName)` — adopters can reuse the same tag string across unrelated table pairs (e.g. a generic `'audit'` tag on multiple tables).

**Migration:** none required for existing schemas. The `relationName` field is optional everywhere; M3 schemas keep compiling unmodified.

Spec: `docs/db/spec-relation-name.md`. Tracks closing M4.B from `docs/db/m4-plan.md`.
