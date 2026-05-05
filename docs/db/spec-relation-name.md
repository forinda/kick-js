# Spec — `relationName` for multi-FK disambiguation

> **Status:** Draft v1 — 2026-05-05. Sub-spec for [`m4-plan.md`](./m4-plan.md) §M4.B. Locks the DSL surface, the resolver precedence rule, and the typegen wiring before code lands.

**Owner:** kickjs-db maintainers
**Architecture parent:** [`spec-relational-query.md`](./spec-relational-query.md) §3 "Type-level shape" + [`m3-plan.md`](./m3-plan.md) §A.4 (`extract-relations.ts`)
**Related code:** `packages/db/src/dsl/relations.ts` (`Helpers.one` / `Helpers.many`), `packages/db/src/query/extract-relations.ts` (`findInverseOne` + `resolveByForeignKey` precedence), `packages/db/src/query/errors.ts` (`RelationalQueryMissingInverseError`)

---

## 1. Problem

When two tables share more than one foreign key to the same target, M3.A's resolver can't pick the right one. Concrete topology:

```ts
const messages = table('messages', {
  id: uuid().primaryKey().defaultRandom(),
  senderId: uuid()
    .notNull()
    .references(() => users.id),
  recipientId: uuid()
    .notNull()
    .references(() => users.id),
  body: text().notNull(),
})
```

The adopter wants four relations:

```ts
relations(messages, ({ one }) => ({
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  recipient: one(users, { fields: [messages.recipientId], references: [users.id] }),
}))

relations(users, ({ many }) => ({
  sentMessages: many(messages),
  receivedMessages: many(messages),
}))
```

`extractRelations` today fails:

- `findInverseOne` walks `messages`'s relations for an entry whose `target` is `users`. Two match (`sender` + `recipient`); the loop returns the first, which is wrong half the time.
- `resolveByForeignKey` walks `messages.foreignKeys` for entries referencing `users`. Two match; the helper returns `null` because it requires exactly one match.
- The whole chain throws `RelationalQueryMissingInverseError` with no actionable hint.

Drizzle solves this with `relationName: 'foo'` — a string tag declared on **both** sides of the same logical relation, so the resolver can pair them up. M4.B ports the same pattern.

---

## 2. Goals

1. **Multi-FK schemas compile cleanly.** When two relations point at the same target table, adopters disambiguate with `relationName` and the resolver uses the matching pair.
2. **Strict opt-in.** The current single-FK / single-inverse fast path stays unchanged. Schemas that don't need `relationName` never see it.
3. **Compile-time error message points at the fix.** When the resolver hits ambiguity AND no `relationName` is declared, the error tells the adopter to add `relationName: 'foo'` to both sides.
4. **Typegen passes the name through.** `SchemaToRelationsRegister<S>` carries the optional `relationName` so call-site `with` keys still type-check correctly.

## Non-goals

1. **Auto-pair by column-name heuristic** (`senderId` ↔ `sentMessages` by stripping `Id` suffix). Brittle; adopters with non-conforming naming get worse errors. Explicit `relationName` is the only signal.
2. **Many-to-many through a join table** as a first-class relation kind. Today's `many` doesn't model junction-table walks; that's a separate spec (tracked for M5+).
3. **Per-relation aliasing inside `with`** — adopters can't rename a relation at the call site. The relation name in `relations()` is the call-site name.

---

## 3. DSL surface

`Helpers.one` already accepts `{ fields, references }`. M4.B adds optional `relationName`:

```ts
export interface RelationOneOpts<...> {
  fields:     ColumnRef[]
  references: ColumnRef[]
  /**
   * Disambiguates this relation from sibling `one` relations on the
   * same source table that point at the same target. Pair with the
   * matching `relationName` on the inverse `many` side. v1 docs
   * recommend kebab-or-camelCase descriptive names ("sent-messages",
   * "authoredPosts") rather than column names ("senderId-fk").
   */
  relationName?: string
}
```

`Helpers.many` today takes only `target`. M4.B adds an optional second arg:

```ts
type Helpers = {
  one: <T>(target: T, opts: RelationOneOpts<...>) => RelationOne<T>
  many: <T>(target: T, opts?: { relationName?: string }) => RelationMany<T>
}
```

Both `RelationOne<TTarget>` and `RelationMany<TTarget>` interfaces gain the optional field at runtime:

```ts
export interface RelationOne<TTarget = ...> {
  kind: 'one'
  target: TTarget
  fields: ColumnRef[]
  references: ColumnRef[]
  relationName?: string  // ← new
}

export interface RelationMany<TTarget = ...> {
  kind: 'many'
  target: TTarget
  relationName?: string  // ← new
}
```

The change is strictly additive — no existing call site needs to update.

### Adopter-facing example

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

The string passed to `relationName` is purely a pairing tag — it can match the relation key (as above) or be a separate descriptive name. v1 recommends matching the key for clarity.

---

## 4. Resolver precedence

`extractRelations` for a `many` relation walks the candidate inverses in this order:

1. **`relationName` match — both sides declared.** If the source's `many` declares `relationName: 'foo'` AND the target has at least one `one` declaring the same `relationName: 'foo'` AND that `one` points back at the source, use it. Pick exactly one match — if multiple inverse `one`s share the same name (operator error), throw `RelationalQueryAmbiguousRelationNameError` with the conflicting names.
2. **Single inverse `one` — neither side declares `relationName`.** M3 behavior. If the target has exactly one `one` pointing back at the source and neither side has a name, use it.
3. **FK introspection fallback — neither side declares `relationName`.** M3 fallback. If the target table has exactly one foreign key referencing the source, use those columns.
4. **Throw `RelationalQueryMissingInverseError`** — no pair found. Error message includes a hint to add `relationName` to both sides if multiple FKs / inverses are detected.

Same `one` resolver path applies symmetrically: when resolving a `one` relation that needs columns, the same `relationName` rule pairs it with the matching inverse `many` (though for `one` the `fields` / `references` are explicit at the call site, so the resolver only needs `relationName` to disambiguate type-level inverses for `SchemaToRelationsRegister<S>`).

### Why precedence — not "always prefer relationName"

Adopters with single-FK schemas don't write `relationName` and shouldn't have to. Step 1 only fires when both sides explicitly opt in; steps 2 and 3 keep the old happy path. This means:

- M3 schemas keep working unmodified.
- Multi-FK schemas opt into step 1 by adding `relationName` to both sides.
- Ambiguous schemas without `relationName` fail with a clear error pointing at step 1 as the fix.

---

## 5. Type-level wiring

`RelationMapEntry` (in `packages/db/src/query/types.ts`) gains optional `relationName`:

```ts
export interface RelationMapEntry {
  kind: 'one' | 'many'
  target: string
  relationName?: string // ← new
}
```

`SchemaToRelationsRegister<S>` (`schema-relations-types.ts`) walks `relations()` declarations the same way today. The new `relationName` field flows through naturally because `R[K]['relationName']` is part of the inferred `R` shape:

```ts
type ResolveRelations<R extends Record<string, Relation>> = {
  [K in keyof R]: {
    kind: R[K]['kind']
    target: R[K]['target'] extends TableDecl<infer N, ...> ? N : string
    relationName: R[K]['relationName']  // undefined when not declared
  }
}
```

Optional property semantics on the `RelationMapEntry` declaration mean adopters who don't use `relationName` get `undefined` flowing through, which is fine.

The `kick/db` typegen plugin emits the augmentation unchanged — `SchemaToRelationsRegister<typeof appSchema>` covers the new field automatically. No plugin changes needed.

---

## 6. Edge cases

| Case                                                                                | Behavior                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both sides declare matching `relationName`                                          | Step 1: pair them, use the `one`'s `fields` / `references` for the join. Happy path.                                                                                               |
| `relationName` on one side only                                                     | Step 1 fails (no matching pair). Falls through to step 2; if step 2 / step 3 also fail (likely, since multi-FK is what motivates the name), throw `MissingInverseError` with hint. |
| Two `many` declarations with the same `relationName`                                | `RelationalQueryAmbiguousRelationNameError` at extract time. Operator error.                                                                                                       |
| `relationName` shadows a column name on the same table                              | No collision: `relationName` is a join-pairing tag, not a relation key. Doesn't reach the alias-collision check.                                                                   |
| Self-referencing multi-FK (`tasks.parentTaskId` + `tasks.blockedById` both → tasks) | Step 1 pairs by `relationName` per usual. Self-references already alias per level (M3 fix); the alias scheme is orthogonal to `relationName`.                                      |
| `kick db generate` doesn't read `relationName`                                      | Migrations are unaffected — `relationName` is query-time sugar, not DDL. Same disposition as the existing relations sidecar.                                                       |
| Adopter adds `relationName` to a single-FK schema                                   | No-op. Step 1 fires (matched pair), produces the same join columns step 2 would have produced. Strictly safe.                                                                      |

---

## 7. Resolved decisions

- **R-1 — Mismatched `relationName` on the two sides falls through to step 2/3, not throw.** Reason: the typo case (`'sentMessages'` vs `'sentMessage'`) is hard to distinguish from "one side has the name and the other doesn't." Falling through gives the same `MissingInverseError` adopters already see for ambiguous schemas; the error message lists declared names so typos are visible. **Resolved 2026-05-05, default.**
- **R-2 — Two `many` with the same `relationName` throw a new dedicated error class** (`RelationalQueryAmbiguousRelationNameError`). Catches the duplicate-tag operator error early. Resolved 2026-05-05, default.
- **R-3 — `relationName` on `Helpers.many` makes the second arg optional with the new field as the only key.** Avoids a breaking signature change. Resolved 2026-05-05, default.
- **R-4 — Recommended naming is the relation key on the `many` side** (`sentMessages: many(messages, { relationName: 'sentMessages' })`). Documented in the adopter guide. Adopters can pick anything; the recommendation just keeps the schema readable. Resolved 2026-05-05, default.
- **R-5 — Backwards compat: optional everywhere, no migration required.** Existing M3 schemas keep working unmodified. Resolved 2026-05-05, default.

---

## 8. Open questions

None at draft v1 — every decision in §7 has a default. Reviewer can flip any of R-1 through R-5.

---

## 9. Acceptance — exits the spec when

- [ ] Reviewer sign-off on §3 (DSL surface) and §4 (resolver precedence).
- [ ] §7 resolved decisions accepted as written, or specific items called out for flipping.
- [ ] No outstanding "Todo" or "TBD" lines in this file.
- [ ] `m4-plan.md` Step B.1 marked `[x]`.

Spec is locked. M4.B.2 (DSL types) becomes the next session.

---

## 10. Changelog

| Date       | Author | Note           |
| ---------- | ------ | -------------- |
| 2026-05-05 | claude | Initial draft. |
