# Relational Queries

`db.query.<table>.findMany({ with })` (plus `findFirst` / `findUnique`) is the relational read API on `@forinda/kickjs-db`. It compiles to a single round trip per call — one query that aggregates parents and every nested level of children into a JSON tree the client decodes.

The runtime ships for **PostgreSQL**, **SQLite**, and **MySQL 8+** as of v5.4.0.

## When to reach for it

| Pattern                                                     | Use this                                      | Use Kysely                           |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| "Get task X plus its comments, assignees, labels"           | `db.query.tasks.findUnique({ with: { … } })`  | —                                    |
| "Get the 20 newest projects with their tasks and lead user" | `db.query.projects.findMany({ with: { … } })` | —                                    |
| "Count tasks by status across a workspace"                  | —                                             | `db.selectFrom('tasks').select(...)` |
| "Update + return"                                           | —                                             | `db.updateTable(...).returningAll()` |

The relational layer is read-only. Inserts, updates, deletes, and any non-trivial aggregation continue to flow through Kysely — `db.selectFrom` / `insertInto` / `updateTable` etc. The two coexist on the same `KickDbClient`.

## First findMany

```ts
import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

@Service()
export class WorkspacesRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  recentWorkspaces() {
    return this.db.query.workspaces.findMany({
      orderBy: (_w, eb) => eb.ref('createdAt'),
      limit: 20,
    })
  }
}
```

The return type narrows from the inferred schema — column types from the DSL flow through. No `as` casts.

## Adding `with`

`with` walks the relations declared in your `relations()` blocks. The keys are checked against the `KickDbRelationsRegister` augmentation that `kick typegen` emits to `.kickjs/types/kick__db.d.ts` — so misspelling a relation key is a compile error, not a runtime surprise.

```ts
this.db.query.workspaces.findUnique({
  where: (_w, eb) => eb('id', '=', id),
  with: {
    owner: true, // one-relation → workspace.owner: User
    members: true, // many-relation → workspace.members: Member[]
    projects: true, // many-relation → workspace.projects: Project[]
  },
})
```

One round trip. Every nested column is included in the inner JSON.

## Nested `with`

Pass an object instead of `true` to keep walking:

```ts
this.db.query.tasks.findUnique({
  where: (_t, eb) => eb('id', '=', id),
  with: {
    comments: {
      with: { author: true }, // each comment carries its author
    },
    assignees: {
      with: { user: true },
    },
    labels: true,
  },
})
```

Each level pushes another nested `LATERAL` (PG) / correlated subquery (SQLite/MySQL). Default depth limit is 3; raise it with `maxDepth` on the call options when you need deeper nesting.

## Per-relation `where`, `orderBy`, `limit`

Inside a `with` value you can constrain the inner subquery the same way as the outer:

```ts
this.db.query.users.findUnique({
  where: (_u, eb) => eb('id', '=', userId),
  with: {
    posts: {
      where: (p, eb) => eb.isNotNull(p.publishedAt),
      orderBy: (_p, eb) => eb.ref('publishedAt').desc(),
      limit: 5,
    },
  },
})
```

Each clause scopes only to the inner relation — outer filters keep working independently.

## Self-references and cycles

Aliases are depth-suffixed under the hood (`tasks_0`, `tasks_1`, `tasks_2`…) so self-referencing relations don't collide:

```ts
// Schema:
// tasks.parentTaskId references tasks.id
// relations: parentTask: one(tasks, { … }), subtasks: many(tasks)

this.db.query.tasks.findUnique({
  where: (_t, eb) => eb('id', '=', id),
  with: {
    parentTask: true,
    subtasks: {
      with: { subtasks: true }, // 2-deep self-ref
    },
  },
})
```

Two-FK cycles where the same target table is referenced by two distinct columns (e.g. `messages.senderId` + `messages.recipientId` both → `users`) need a `relationName: 'foo'` tag on both sides. See [the relation-name spec](../db/spec-relation-name.md) for the full pattern.

## Dialect notes

PG uses `json_agg` / `to_json` (single LATERAL per `with` key, empty arrays return `[]`).

SQLite uses `json_group_array(json_object(...))` for `many` and `json_object(...)` for `one`. Empty `many` returns `[]`; empty `one` returns `null`.

MySQL 8+ uses `JSON_ARRAYAGG(JSON_OBJECT(...))` for `many`. MySQL's `JSON_ARRAYAGG` returns `NULL` over zero rows; the runtime wraps it in `COALESCE(..., JSON_ARRAY())` so the client always sees `[]`. **MySQL 5.x is not supported** — `JSON_ARRAYAGG` doesn't exist there. Adopters get a runtime version assertion when `mysqlAdapter()` boots.

## Errors you might hit

- **`RelationalQueryUnknownRelationError`** — the `with` key isn't in the relations registry. Run `kick typegen` (or `kick dev`); this almost always means the typegen output is stale.
- **`RelationalQueryDepthError`** — the request exceeds `maxDepth` (default 3). Raise the limit on the call or restructure the query.
- **`RelationalQueryAmbiguousRelationNameError`** — two relations share the same name in the registry. Disambiguate via `relationName: 'foo'` on both sides.
- **`RelationalQueryMissingInverseError`** — a `many` relation can't find its inverse `one`. Either add the inverse in the relations file or tag both sides with `relationName: 'foo'`.

## Cancelling in-flight queries

`db.query.findMany` / `findFirst` / `findUnique` accept an optional `signal: AbortSignal`. Bind to `RequestContext.signal` from kickjs-http to short-circuit relational queries when the client disconnects or the request times out — no manual `Promise.race`.

```ts
@Service()
export class TasksRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  findFullById(id: string, signal: AbortSignal) {
    return this.db.query.tasks.findUnique({
      where: (_t, eb) => eb('id', '=', id),
      with: { comments: true, assignees: true, labels: true },
      signal,
    })
  }
}

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksRepository) {}
  @Get('/tasks/:id')
  async show(ctx: RequestContext) {
    return ctx.json(await this.tasks.findFullById(ctx.params.id, ctx.signal))
  }
}
```

When the signal fires the promise rejects with `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`). The signal's `reason` flows onto the error's `cause` field — adopters can distinguish HTTP timeout vs explicit cancel by inspecting it.

Already-aborted signals short-circuit before any compile or DB round trip. The default cancellation strategy is Kysely's `'ignore query'` — JS-side promise rejects immediately, DB-side query keeps running until completion. Adopters who need true `pg_cancel_backend` / `KILL QUERY` semantics drive Kysely directly via `db.qb.executeQuery(...)` until a future release exposes a per-call override.

## Narrowing the client

Kysely 0.29 adds three compile-time narrowing helpers. They live on `KickDbClient<DB>` (which extends `Kysely<DB>`) so adopters get them for free:

### `ReadonlyKysely<DB>` — read-only repos

```ts
import { Inject, Service } from '@forinda/kickjs'
import { DB_PRIMARY, type ReadonlyKysely } from '@forinda/kickjs-db'

@Service()
export class WorkspacesQueryRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: ReadonlyKysely<KickDb>) {}

  list() {
    return this.db.selectFrom('workspaces').selectAll().execute()
  }
  // this.db.insertInto('workspaces')
  //   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Property does not exist on ReadonlyKysely
}
```

`selectFrom` / `with` / `case` / `fn` / `dynamic` / `introspection` / `isTransaction` / `destroy` are kept; `insertInto` / `updateTable` / `deleteFrom` / `mergeInto` are removed at the type level. The runtime is the same `KickDbClient` instance — TS is the gate.

### `$pickTables<...>()` — module-scoped views

```ts
@Service()
export class WorkspacesAdminQueryRepository {
  // Inject the full client; narrow at call time so this repo can ONLY
  // touch `workspaces` + `workspaceMembers`. Trying to selectFrom
  // `tasks` is a compile error.
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient<KickDb>) {}

  listMembers(workspaceId: string) {
    return this.db
      .$pickTables<'workspaces' | 'workspaceMembers'>()
      .selectFrom('workspaceMembers')
      .where('workspaceId', '=', workspaceId)
      .selectAll()
      .execute()
  }
}
```

### `$omitTables<...>()` — soft-delete-style guards

```ts
// Layer-1 repo never touches the audit_log table — narrow it out at
// the boundary so accidental writes are compile errors.
db.$omitTables<'audit_log'>().updateTable('users').set({ ... }).execute()
// db.$omitTables<'audit_log'>().updateTable('audit_log')
//                                            ^^^^^^^^^ Argument not assignable
```

All three return Kysely instances backed by the same connection pool — narrowing is purely structural; no runtime cost.

## Reference: `task-kickdb-api`

The example app uses the relational layer in three places:

| File                                              | Method                    | Returns                                             |
| ------------------------------------------------- | ------------------------- | --------------------------------------------------- |
| `src/modules/tasks/tasks.repository.ts`           | `findFullById(id)`        | task + comments + assignees + labels                |
| `src/modules/workspaces/workspaces.repository.ts` | `findFullById(id)`        | workspace + owner + members (with users) + projects |
| `src/modules/workspaces/workspaces.repository.ts` | `listOwnedByUser(userId)` | owned workspaces + members + projects               |

Each method replaced an N+1 in a controller. The `with` keys are typed against `KickDbRelationsRegister` — try renaming `members` to `member` in any call to see the compile-time guard fire.

## Migrating from N+1

Typical pattern before:

```ts
// Three round trips, awkward to type, easy to forget one
async function workspaceOverview(id: string) {
  const ws = await this.workspaces.findById(id)
  if (!ws) return null
  const members = await this.workspaceMembers.listByWorkspace(id)
  const projects = await this.projects.listByWorkspace(id)
  return { ...ws, members, projects }
}
```

After:

```ts
// One round trip, types flow from the schema, no manual assembly
async function workspaceOverview(id: string) {
  return this.workspaces.findFullById(id) // see workspaces.repository.ts
}
```

The `with` shape is enforced by the typegen registry — the registry stays in sync with the schema as long as `kick typegen` runs (it's wired into `kick dev` and `pretypecheck`).
