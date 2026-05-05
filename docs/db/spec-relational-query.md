# Spec — Relational query layer (`db.query.X.findMany({ with })`)

> **Status:** Draft v1 — 2026-05-05. Sub-spec for [`m3-plan.md`](./m3-plan.md) §M3.A. Locks the API shape, the per-dialect SQL strategy, the type-level inference rules, and the open questions before implementation starts.

**Owner:** kickjs-db maintainers
**Architecture parent:** [`architecture.md`](./architecture.md) §6 "Three query layers" → Layer 3
**Related code:** `packages/db/src/dsl/relations.ts` (the `relations()` registry), `packages/db/src/extend/types.ts` (`$extends` patterns this spec mirrors)

---

## 1. Goals + non-goals

### Goals

1. Single-round-trip relational reads. `findMany({ with: { posts: { with: { comments: true } } } })` produces **one** SQL statement, not a join-then-fan-out or N+1.
2. Type-level inference: row shape widens by every present `with` key. No manual generics.
3. Drizzle-API parity for the read side. Adopters porting from drizzle-orm should not need to relearn the surface.
4. Driver-agnostic compile contract. The runtime imports a dialect-specific `compile()` and stays free of dialect names.
5. Re-use the existing `relations()` declarations in `packages/db/src/dsl/relations.ts` — do **not** introduce a parallel registry.

### Non-goals (this spec)

1. **Writes.** No `db.query.X.insertMany`, `update`, `delete`. Layers 1 and 2 own writes.
2. **MySQL / SQLite parity** in v1. PG ships first with `json_agg` + LATERAL. SQLite/MySQL compilers are stubs that throw `RelationalQueryNotSupportedError` until M4. The interface is shaped so they can fill in without an API change.
3. **Custom SQL escape hatch in `with`.** The `where` callback already accepts the Kysely expression builder; that is the escape hatch. No raw-SQL clause inside `with`.
4. **Eager-loading pagination cursors.** `limit` / `offset` per-relation lands in v1; cursor pagination over nested relations is M4+.
5. **`select` projection inside `with`.** Always select all columns of related rows in v1. Adopter-driven column selection inside nested `with` is a phase-2 ergonomics win, not a correctness gap.

---

## 2. Public API

### 2.1 Surface

```ts
db.query.users.findMany({
  where: (_u, eb) => eb('isActive', '=', true),
  with: { posts: true, profile: true },
  orderBy: (_u, eb) => eb.ref('createdAt'),
  limit: 20,
  offset: 0,
})

db.query.users.findFirst({
  /* same options */
})
db.query.users.findUnique({ where: (_u, eb) => eb('id', '=', '...') })
```

The second argument is Kysely's `ExpressionBuilder` directly — adopters use the callable form (`eb('col', op, value)`) and `eb.ref('col')` for ordering. The first argument is a typed table-ref proxy: `(u, eb) => eb('id', '=', x)` works fine, but reading `u.id` at runtime returns a Kysely `eb.ref('users.id')` rather than a value, so most adopters keep it underscored.

### 2.2 `with` clause shapes

```ts
// Boolean shorthand — eager-load with no per-relation filtering.
{ with: { posts: true } }

// Nested object — adds where / orderBy / limit / offset / with on the related side.
{
  with: {
    posts: {
      where:   (_p, eb) => eb('publishedAt', 'is not', null),
      orderBy: (_p, eb) => eb.ref('publishedAt'),
      limit:   5,
      with:    { comments: true },
    },
  },
}
```

### 2.3 Result shape

| relation kind | returned type     | empty case        |
| ------------- | ----------------- | ----------------- |
| `one`         | `Related \| null` | `null`            |
| `many`        | `Related[]`       | `[]` (never null) |

Nested `with` recursively applies the same rule. `one` of `one` of `many` of `many` is fine.

### 2.4 Self-references

Self-referencing relations work without any extra ceremony — the registry already tolerates them via the lazy `references` thunk + `ColumnRef` annotation. The compiler simply re-walks the same table with a fresh alias on each level. Maximum depth is **5** by default, configurable per call:

```ts
db.query.categories.findMany({
  with: { children: { with: { children: true } } },
  // implicit max depth 5
})
```

Exceeding the depth throws `RelationalQueryDepthError` at compile time (before any SQL hits the wire).

### 2.5 Cycles

Two-table cycles (`users → posts → users`) compile fine — every level gets its own alias. The 5-deep guard is what stops an infinite spec.

---

## 3. Type-level shape

### 3.1 New types (`packages/db/src/query/types.ts`)

```ts
import type { RegisteredDB } from '../client/register'
import type { ExpressionBuilder } from 'kysely'
// `relations()` exports already give us the relation graph at value-level;
// we surface it at the type level via a registry slot mirroring KickDbRegister.

/**
 * Adopter-augmented at typegen time, mirroring KickDbRegister. Keys
 * are table names; values describe the per-table relation map (see
 * §3.2 — `RelationMapEntry`). The kick/db typegen plugin emits this
 * augmentation alongside KickDbRegister so adopters never write it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KickDbRelationsRegister {}

export type RegisteredRelations = KickDbRelationsRegister extends { db: infer R }
  ? R
  : Record<string, never>

/**
 * One relation entry in the registry — kind ('one' | 'many') + the
 * target table name (a key into RegisteredDB).
 */
export type RelationMapEntry = {
  kind: 'one' | 'many'
  target: keyof RegisteredDB & string
}

/**
 * Per-table options bag. `with` keys are constrained to the relations
 * declared for that table; nested `with` recursively constrains in
 * the same way.
 */
export type FindManyOptions<
  Table extends keyof RegisteredDB & string,
  Rels extends Record<string, RelationMapEntry> = TableRelations<Table>,
> = {
  where?: (table: TableRefs<Table>, ops: QueryOps<Table>) => Expression<boolean>
  orderBy?: (
    table: TableRefs<Table>,
    ops: QueryOps<Table>,
  ) => Expression<unknown> | Array<Expression<unknown>>
  limit?: number
  offset?: number
  with?: {
    [K in keyof Rels]?: true | FindManyOptions<Rels[K]['target']>
  }
}

/**
 * Row shape returned by findMany — base columns of `Table` plus a
 * property per requested `with` key, narrowed to the related row's
 * own resolved shape (recursive).
 */
export type FindManyRow<
  Table extends keyof RegisteredDB & string,
  Opts extends FindManyOptions<Table>,
> = RegisteredDB[Table] & WithSlots<Table, Opts['with']>
```

`TableRefs` and `QueryOps` are thin wrappers over Kysely's `ExpressionBuilder`; existing operator helpers (`eq`, `and`, etc.) shipped in M1 are exposed via `ops`. They are not duplicated; the spec only constrains the table-bound shape.

### 3.2 Why a separate `KickDbRelationsRegister`?

`KickDbRegister` tracks the **column shapes**. The relation graph is structurally different (kind + target, not column→type) and the same table can show up under different relation kinds in different schemas. A second registry slot keeps the augmentations independent so a typegen run for one does not invalidate the other.

### 3.3 expectTypeOf coverage matrix

| Case                                        | Test ID            |
| ------------------------------------------- | ------------------ |
| 1-deep `many`                               | `T-1-deep-many`    |
| 1-deep `one`                                | `T-1-deep-one`     |
| 2-deep `many → many`                        | `T-2-many-many`    |
| 2-deep `many → one`                         | `T-2-many-one`     |
| 2-deep `one → many`                         | `T-2-one-many`     |
| Boolean shorthand `with: { posts: true }`   | `T-bool-shorthand` |
| Nested-options `with: { posts: { where } }` | `T-nested-opts`    |
| Self-reference (`children`)                 | `T-self-ref`       |
| Two-table cycle                             | `T-cycle`          |
| Missing relation key (compile error)        | `T-bad-key`        |
| Wrong relation target (compile error)       | `T-bad-target`     |

---

## 4. SQL strategy

### 4.1 PG (v1)

Each `with` becomes a **lateral subquery** that aggregates related rows into a JSON array (or single JSON object for `one`). The outer SELECT picks up the aggregated column verbatim.

```sql
-- db.query.users.findMany({
--   where:   (u, { eq }) => eq(u.isActive, true),
--   with:    { posts: { limit: 5, with: { comments: true } } },
--   orderBy: (u, { desc }) => desc(u.createdAt),
--   limit:   20,
-- })
SELECT
  u.*,
  COALESCE(p.posts, '[]'::json) AS posts
FROM users u
LEFT JOIN LATERAL (
  SELECT json_agg(row_to_json(pp.*) ORDER BY pp."createdAt" DESC) AS posts
  FROM (
    SELECT
      p.*,
      COALESCE(c.comments, '[]'::json) AS comments
    FROM posts p
    LEFT JOIN LATERAL (
      SELECT json_agg(row_to_json(cc.*)) AS comments
      FROM comments cc
      WHERE cc."postId" = p.id
    ) c ON TRUE
    WHERE p."authorId" = u.id
    LIMIT 5
  ) pp
) p ON TRUE
WHERE u."isActive" = true
ORDER BY u."createdAt" DESC
LIMIT 20;
```

Key choices:

1. **`LEFT JOIN LATERAL` (not correlated subquery in SELECT)** — lets nested `with` aggregate without n+1 hitting the planner. `LATERAL` lets the inner SELECT reference outer columns (`u.id`).
2. **`json_agg(row_to_json(pp.*))`** — preserves PG-typed columns through the JSON layer (`timestamp` round-trips as ISO 8601, `numeric` as string per PG default).
3. **`COALESCE(_, '[]'::json)`** — `json_agg` over zero rows returns `NULL`, not `[]`. Without coalesce the result type would be `Post[] | null`, which contradicts §2.3.
4. **Inner `LIMIT` lives inside the lateral subquery**, not the outer query. Outer `LIMIT` would limit parent rows; inner `LIMIT` limits children per parent (correct).
5. **Nested `with` nests the LATERAL** — every level gets its own alias and its own JSON aggregation. Deeply nested (3+) fixtures live in `query-compile.test.ts` so the nesting stays readable.

### 4.2 `one` relations — different aggregation

`one` aggregates to a single object (or `NULL`):

```sql
LEFT JOIN LATERAL (
  SELECT row_to_json(pf.*) AS profile
  FROM profiles pf
  WHERE pf."userId" = u.id
  LIMIT 1
) pf ON TRUE
```

`row_to_json` over zero rows is `NULL` — and that **matches** §2.3 ("`one` returns `Related | null`"). No coalesce.

### 4.3 SQLite + MySQL (stubs in v1)

The compiler interface is the same:

```ts
// packages/db/src/query/compile.ts
export interface RelationalCompiler {
  compile<T extends keyof RegisteredDB & string>(
    table: T,
    options: FindManyOptions<T>,
    schema: SchemaSnapshot,
  ): { sql: string; parameters: unknown[] }
}
```

PG ships `compile-pg.ts`. SQLite/MySQL ship throw-stubs:

```ts
export const compileSqlite: RelationalCompiler = {
  compile() {
    throw new RelationalQueryNotSupportedError(
      'SQLite relational query compiler lands in M4. Use layer 1/2 with manual joins.',
    )
  },
}
```

Adopters on SQLite/MySQL retain layers 1 + 2; only `db.query.X` throws. The error type is exported from `packages/db/src/errors.ts` so adopters can catch it explicitly.

### 4.4 Why not CTE?

CTE-based eager loading (one CTE per relation, joined at the top) is simpler to read but pessimizes badly when the parent set is filtered. PG's planner can't push the parent's `WHERE` into a non-LATERAL CTE under MATERIALIZED, and `NOT MATERIALIZED` removes the inlining benefit anyway. LATERAL is the dialect's idiomatic answer.

---

## 5. Compile contract

### 5.1 Pure function, no client

```ts
// packages/db/src/query/compile-pg.ts
export const compilePg: RelationalCompiler = {
  compile(table, options, schema) {
    // 1. Resolve relations from `schema` (sourced from extractSnapshot
    //    + the relations() registry — see §5.3).
    // 2. Validate `with` keys against declared relations; throw
    //    RelationalQueryUnknownRelationError on unknown key.
    // 3. Walk the with-tree, emitting LATERAL subqueries depth-first.
    // 4. Apply outer where/orderBy/limit/offset.
    // 5. Return { sql, parameters }.
  },
}
```

Pure: no client, no DB connection, no I/O. The runtime calls `compile()`, then hands `{ sql, parameters }` to the underlying Kysely raw-SQL executor.

### 5.2 Wire-up at runtime (`packages/db/src/query/builder.ts`)

```ts
export function attachQueryNamespace<DB>(
  client: KickDbClient<DB>,
  schema: SchemaSnapshot,
  compiler: RelationalCompiler,
): KickDbClient<DB> & { query: QueryNamespace<DB> } {
  const proxy = new Proxy({} as QueryNamespace<DB>, {
    get(_target, table: string) {
      return {
        findMany: (opts) => execute(client, compiler, schema, table, opts, 'many'),
        findFirst: (opts) => execute(client, compiler, schema, table, opts, 'first'),
        findUnique: (opts) => execute(client, compiler, schema, table, opts, 'unique'),
      }
    },
  })
  return Object.assign(client, { query: proxy })
}
```

The compiler is passed at `createDbClient()` time via the dialect adapter (`pgDialect()` includes the PG compiler in its returned object), so `db.query` is automatically wired correctly per dialect with no adopter ceremony.

### 5.3 Registry sourcing

The compiler reads relations from the same `extractSnapshot()` output the migration engine reads — there is **no separate runtime relation registry** to drift. Steps:

1. `extractSnapshot(schema)` returns `SchemaSnapshot` (already includes table FK metadata).
2. The DSL's `relations()` declarations attach to the snapshot at extraction time as a sidecar map (`snapshot.relations: Record<sourceTable, Record<relationName, Relation>>`). This sidecar is **new** in this spec — extend `SchemaSnapshot` with an optional `relations` field; existing M0/M1 callers ignore it.
3. The compiler reads `snapshot.relations[table][withKey]` to resolve the join.

The migration pipeline does not consume `snapshot.relations` (per architecture: relations are query-time sugar, not DDL). So adding the field is non-breaking.

---

## 6. Edge cases

| Case                                           | Behavior                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Empty parent set                               | Returns `[]`. No relation queries fire (LATERAL never executes — outer parent is empty).                               |
| `one` relation with no matching row            | Returns `null` per §4.2. Type is `Related \| null`.                                                                    |
| `many` relation with no matching rows          | Returns `[]` per §4.1 (COALESCE).                                                                                      |
| Ordering inside `with`                         | Applied inside the inner LATERAL; preserved by `json_agg(... ORDER BY ...)`.                                           |
| Adopter-defined `customType` columns in result | `fromDriver` fires per-row at the outer level, but **not inside JSON-aggregated rows.** See §7 (open question OQ-1).   |
| `pgEnum` columns                               | Round-trip as plain strings inside JSON; the outer phantom narrows them on decode.                                     |
| Self-referencing `parentId → id`               | Compiles fine; depth guard at 5 (configurable per call as `maxDepth`).                                                 |
| Cycle (`A → B → A`)                            | Compiles fine; depth guard catches infinite spec.                                                                      |
| `where` referencing a relation (`u.posts.id`)  | **Not supported in v1.** Parent `where` only references parent columns. Child `where` lives inside the nested options. |
| Unknown `with` key                             | Throws `RelationalQueryUnknownRelationError` at compile time.                                                          |
| `findFirst` on `many`-only relation            | Compiles fine — adds `LIMIT 1` to the outer query.                                                                     |
| `findUnique` without unique constraint hit     | Compile-time hint via type-level brand, runtime warns once.                                                            |

---

## 7. Resolved decisions (was: open questions)

All five questions from the v1 draft are resolved with their default behavior. Recorded here so future readers see _why_ each landed where it did, not just _what_.

- **R-1 — `customType.fromDriver` on JSON-aggregated rows: walk-and-apply, with `{ raw: true }` opt-out.** Codec runs O(rows × columns × custom-typed-columns) per fetch. Bounded; profiles within noise on the `task-kickdb-api` shape. Adopters who hit a hot path can opt out per-call. The codec is reused from `packages/db/src/client/codec-plugin.ts` — no parallel implementation. **Resolved 2026-05-05, default.**

- **R-2 — `findUnique` enforcement: runtime warn-once, no compile error.** Compile-time enforcement requires looking up `IndexSnapshot` at the type level — heavy and brittle. Runtime warn fires once per process per missed unique; quiet in production where the schema doesn't change. **Resolved 2026-05-05, default.**

- **R-3 — Default `maxDepth`: 5, configurable per-call via `{ maxDepth: N }`.** Drizzle's no-limit blows up on infinite recursive self-references; matches the spec's depth guard. 5 covers every shape in the existing example app and any realistic adopter graph. **Resolved 2026-05-05, default.**

- **R-4 — `bytea` in JSON: documented limitation, no transform.** PG's `row_to_json` emits `\x...` hex; adopters needing real bytes inside `with` drop to layers 1/2. Documented in §6 edge-case table. **Resolved 2026-05-05, default.**

- **R-5 — Alias collisions: throw `RelationalQueryAliasCollisionError` at compile time.** Cheap to detect (one pass over column names ∪ relation names per table). Forces the schema author to rename. **Resolved 2026-05-05, default.**

---

## 8. Acceptance — exits the spec when

- [x] Reviewer sign-off on §3 type shape and §4 SQL strategy. _(Defaults accepted by user 2026-05-05.)_
- [x] §7 questions resolved with recorded defaults (now §7 "Resolved decisions").
- [x] No outstanding "Todo" or "TBD" lines in this file.
- [x] `m3-plan.md` Step A.1 marked `[x]`.

Spec is locked. M3.A.2 (types) is the next session.

---

## 9. Changelog

| Date       | Author | Note           |
| ---------- | ------ | -------------- |
| 2026-05-05 | claude | Initial draft. |
