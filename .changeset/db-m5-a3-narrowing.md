---
'@forinda/kickjs-db': minor
---

feat(db): re-export `ReadonlyKysely` + document `$pickTables` / `$omitTables` (M5.A.3)

Kysely 0.29's compile-time narrowing helpers are now reachable from `@forinda/kickjs-db` directly. `ReadonlyKysely<DB>` is re-exported as a named type — adopters writing query-side repositories inject `ReadonlyKysely<KickDb>` to make `insertInto` / `updateTable` / `deleteFrom` / `mergeInto` compile errors, no runtime layer needed.

```ts
@Service()
export class WorkspacesQueryRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: ReadonlyKysely<KickDb>) {}

  list() {
    return this.db.selectFrom('workspaces').selectAll().execute()
  }
  // this.db.insertInto(...) → compile error
}
```

`$pickTables<...>()` and `$omitTables<...>()` ship as methods on `Kysely<DB>` (which `KickDbClient<DB>` extends). They were already callable on the existing client surface; M5.A.3 surfaces them in the relational-query guide ([Narrowing the client](https://github.com/forinda/kick-js/blob/main/docs/guide/db-relational-query.md#narrowing-the-client)) so adopters discover them without reading Kysely's docs.

Type-only test suite (`packages/db/__tests__/unit/pick-tables-types.test.ts`) locks the contract so a future Kysely upgrade can't silently drop the helpers from the surface.

Additive — no breaking change. M5 "no major bumps" rule respected.
