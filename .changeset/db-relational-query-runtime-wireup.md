---
'@forinda/kickjs-db': minor
---

Land the runtime surface for `db.query.X.findMany({ with })`. After this release, adopters call the relational read API directly off the client returned by `createDbClient`:

```ts
const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

const rows = await db.query.users.findMany({
  with: { posts: { with: { comments: true } } },
  where: (u, eb) => eb('isActive', '=', true),
  limit: 20,
})
```

PostgreSQL only in this release. SQLite and MySQL clients throw `RelationalQueryNotSupportedError` on first call — a M4-tracked compiler lands in a follow-up.

**New runtime pieces:**

- `KickDbClient<DB>.query: QueryNamespace<DB>` — Proxy-based namespace. Materializes per-table sub-namespaces on first access (`findMany` / `findFirst` / `findUnique`).
- `extractSnapshot` now populates an optional `SchemaSnapshot.relations` sidecar from `relations()` declarations. JSON-serializable; the migration pipeline ignores it. `many` relations resolve via the inverse `one` if declared, falling back to FK introspection so M0/M1 schemas keep working without rewrites.
- `createDbClient` calls `extractSnapshot` once at boot, picks the dialect-specific compiler, and threads both into the client. Adopters write zero extra code.
- `detectDialect` now also inspects the adapter class returned by `createAdapter()`, so hand-rolled `KyselyDialect` literals (common in tests) are recognized as PG / MySQL / SQLite correctly.

**New public exports** from `@forinda/kickjs-db`:

- Types: `FindManyOptions<DB, Table>`, `FindManyRow<DB, Table, Opts>`, `WithClause<DB, Rels>`, `QueryNamespace<DB>`, `TableQueryNamespace<DB, Table>`, `KickDbRelationsRegister`, `RegisteredRelations`, `RelationMapEntry`, `TableRelations<Table>`, `ResolvedRelation`, `ResolvedRelations`, `RelationSnapshot`.
- Error classes: `RelationalQueryUnknownRelationError`, `RelationalQueryDepthError`, `RelationalQueryAliasCollisionError`, `RelationalQueryMissingInverseError`, `RelationalQueryNotSupportedError`. All extend `KickDbError` with stable codes (`KICK_DB_RELATIONAL_*`).

**Type-level shape:** the registry pattern mirrors `KickDbRegister`. Adopters declare a single global augmentation (typegen plugin emits it) and the `with` clause auto-completes against declared relations:

```ts
declare module '@forinda/kickjs-db' {
  interface KickDbRelationsRegister {
    db: {
      users: { posts: { kind: 'many'; target: 'posts' } }
      posts: {
        author: { kind: 'one'; target: 'users' }
        comments: { kind: 'many'; target: 'comments' }
      }
    }
  }
}
```

**Tests:** 17 new tests across `extract-relations.test.ts` (8) and `query-builder.test.ts` (9) bring the db suite to 292 passing. db-pg suite remains green at 17.

**Adopter migration:** none required for existing schemas — the new field is opt-in. Adopters who want to use `db.query.X` declare relations via `relations()` (already shipped in M2), augment `KickDbRelationsRegister`, and call the namespace.
