---
'@forinda/kickjs-db': minor
---

feat(db): re-export `ReadonlyKysely` + document `$pickTables` / `$omitTables` narrowing (M5.A.3)

Kysely 0.29 ships three compile-time narrowing helpers — `$pickTables<...>()`, `$omitTables<...>()`, and the `ReadonlyKysely<DB>` type. They're reachable today through `KickDbClient`'s `db.qb` escape hatch, but adopters who hit them through the bare `@forinda/kickjs-db` import path got no autocomplete and no obvious entry point. M5.A.3 surfaces the type:

```ts
import type { KickDbClient, ReadonlyKysely } from '@forinda/kickjs-db'
import type { KickDb } from '../db/schema' // your SchemaToTypes alias

@Service()
export class WorkspacesQueryRepository {
  private readonly reader: ReadonlyKysely<KickDb>

  constructor(@Inject(DB_PRIMARY) db: KickDbClient<KickDb>) {
    this.reader = db.qb as unknown as ReadonlyKysely<KickDb>
  }

  list() {
    return this.reader.selectFrom('workspaces').selectAll().execute()
  }

  // this.reader.insertInto('workspaces') → compile error:
  //   Argument of type ... is not assignable to parameter of type
  //   'KyselyTypeError<"not allowed with a read-only Kysely instance.">'
}
```

Same pattern for table-set narrowing inside a repo:

```ts
private get reader() {
  return this.db.qb.$pickTables<'workspaces' | 'workspace_members'>()
}
// reader.selectFrom('projects') → compile error, table picked out
```

`ReadonlyKysely` keeps `insertInto` / `updateTable` / `deleteFrom` / `mergeInto` visible in autocomplete, but every call site is typed to return a poisoned `KyselyTypeError<'not allowed with a read-only Kysely instance.'>` sentinel — so the IDE still surfaces the method names while any actual write fails to compile. Pairs cleanly with the `DB_PRIMARY` / `DB_REPLICA` split for read-replica routing.

Adopter doc: [`docs/guide/db-relational-query.md#narrowing-the-client`](https://github.com/forinda/kick-js/blob/main/docs/guide/db-relational-query.md#narrowing-the-client). Tests: 7 type-only `expectTypeOf` cases in `packages/db/__tests__/unit/pick-tables-types.test.ts`.

Additive — no breaking change. M5 "no major bumps" rule respected.
