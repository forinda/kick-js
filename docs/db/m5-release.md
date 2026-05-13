# M5 Release Notes — v5.7.x

**Theme:** close the M4 carry-over (column DEFAULT preservation through `pgEnum` rename-recreate), thread request-scoped cancellation end-to-end through `db.query.*`, and clean up the Kysely-0.29 surface (`ReadonlyKysely` re-export, typed-IR helpers for `ALTER TYPE`, `plugins?` opt-in).

M5 ships in two waves. **M5.A.1** is a correctness patch on `@forinda/kickjs-db`; **M5.A.2 + M5.A.3 + M5.B** are additive minors on the db family; the new **`RequestContext.signal`** lands as an additive minor on `@forinda/kickjs`. No major bumps in the whole milestone — every shipped change fits inside patch or minor semantics, per the M5 "no majors" discipline locked in [`m5-plan.md`](./m5-plan.md).

Two items from the plan didn't land in this cycle: **M5.C** (connection-pool devtools tab) — pure DX, deferred to M6 to avoid blocking the M5 release line; and the **hardening suite** (benchmarks vs drizzle/prisma/raw-pg, diff-engine fuzz, migration replay) that the original architecture spec listed for M5 — also deferred to M6 (see "Out of scope" below). Everything else on the plan shipped.

## Adopter-facing wins

### Column DEFAULT preservation through `pgEnum` rename-recreate (M5.A.1)

[`m4-release.md`](./m4-release.md) "Surfaced gaps" — the rename-recreate dance for `pgEnum` value removal couldn't preserve a column's DEFAULT, because PG refuses the `ALTER COLUMN TYPE … USING …` cast when a DEFAULT references the about-to-be-renamed type. M4.E.1's integration test worked around it by omitting the DEFAULT; real adopter schemas can't.

`emitRemoveEnumValueRecreate` now brackets the type swap with `ALTER COLUMN … DROP DEFAULT` (per affected column) and `ALTER COLUMN … SET DEFAULT 'value'::foo` (re-attached through the freshly-created type name). Columns without a default still emit the bare swap — output is byte-identical to pre-M5.A.1 so previously-applied migration hashes stay valid.

Spec: [`docs/db/spec-default-preservation.md`](./spec-default-preservation.md). Locked by `packages/db/__tests__/unit/default-preservation.test.ts` + the Testcontainers `packages/db/__tests__/integration/enum-drop-with-default.test.ts` lifecycle.

### `AbortSignal` threading through `db.query.*` (M5.A.2)

`FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` accept an optional `signal: AbortSignal`. When the signal fires, the promise rejects with the new `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`). The signal's `reason` flows onto the error's `cause` field so adopters can inspect upstream causes (HTTP timeout vs explicit cancel vs user disconnect).

Already-aborted signals short-circuit before any compile or DB round trip. Driver-level abort shapes (DOM `AbortError`, PG SQLSTATE `57014`, mysql2 `EAGAIN_QUERY_INTERRUPTED`, better-sqlite3 `SQLITE_INTERRUPT`) plus any rejection while `signal.aborted` is true are normalised to `RelationalQueryCancelledError`. Unrelated rejections pass through verbatim.

Default cancellation strategy is Kysely 0.29's `'ignore query'` — JS-side promise rejects, DB-side query keeps running. The stricter `'cancel query'` (`pg_cancel_backend` / `KILL QUERY`) needs per-dialect support and isn't safe across all peers; spec covers the trade-off.

Spec: [`docs/db/spec-abortsignal-threading.md`](./spec-abortsignal-threading.md).

### `RequestContext.signal` — request-scoped cancellation end-to-end (`@forinda/kickjs`)

M5.A.2's changeset recommended adopters "bind to `RequestContext.signal` from kickjs-http" — but `RequestContext.signal` didn't exist yet. This release closes that gap so the integration story is honoured end-to-end.

```ts
@Controller()
export class TasksController {
  @Autowired() private readonly tasks!: TasksRepository

  @Get('/:id/full')
  async showFull(ctx: RequestContext) {
    const row = await this.tasks.findFullById(ctx.params.id as string, ctx.signal)
    if (!row) return ctx.notFound()
    ctx.json(row)
  }
}
```

The repo passes `signal` to `db.query.<table>.findUnique({ signal })`; if the client disconnects mid-flight, the in-flight query rejects with `RelationalQueryCancelledError` instead of consuming the connection until completion.

Implementation: per-request `AbortController` is cached on the underlying `req` object via a `Symbol.for(...)` key, so the multiple `RequestContext` wrappers that router-builder constructs (one per middleware, one per contributor pipeline, one for the main handler) all observe the same signal. Both `req.on('close')` and `res.on('close')` are wired with `.once` — whichever fires first aborts; subsequent fires are no-ops.

Demonstrated end-to-end in `examples/task-kickdb-api`: `TasksController.showFull` (`GET /tasks/:id/full`), `WorkspacesController.showFull` (`GET /workspaces/:id/full`), and `WorkspacesController.ownedBy` (`GET /workspaces/owned-by/:userId`) thread `ctx.signal` into the corresponding `findFullById` / `listOwnedByUser` repo methods.

### `ReadonlyKysely` re-export + `$pickTables` / `$omitTables` doc (M5.A.3)

Kysely 0.29's compile-time narrowing helpers (`$pickTables<...>()`, `$omitTables<...>()`, `ReadonlyKysely<DB>`) are now surfaced on the bare `@forinda/kickjs-db` import path. The `ReadonlyKysely` re-export lets adopters declare read-only repo handles without dipping into `kysely/readonly`:

```ts
import type { KickDbClient, ReadonlyKysely } from '@forinda/kickjs-db'

@Service()
export class WorkspacesQueryRepository {
  private readonly reader: ReadonlyKysely<KickDb>
  constructor(@Inject(DB_PRIMARY) db: KickDbClient<KickDb>) {
    this.reader = db.qb as unknown as ReadonlyKysely<KickDb>
  }
  list() {
    return this.reader.selectFrom('workspaces').selectAll().execute()
  }
  // this.reader.insertInto(...) → compile error (poisoned-call sentinel)
}
```

The four write entrypoints (`insertInto` / `updateTable` / `deleteFrom` / `mergeInto`) stay visible in autocomplete on `ReadonlyKysely`, but every call site is typed to return a `KyselyTypeError<'not allowed with a read-only Kysely instance.'>` sentinel — the IDE shows the method names; the call fails the build.

Adopter guide: [`docs/guide/db-relational-query.md#narrowing-the-client`](../guide/db-relational-query.md).

### ALTER TYPE typed-IR helpers + `plugins?` opt-in (M5.B)

Internal refactor: the four PG `ALTER TYPE` shapes the migration emitter produces (`RENAME TO`, `ADD VALUE`, `ADD VALUE BEFORE/AFTER`, `RENAME VALUE`) flow through one typed IR (`AlterTypeIr`) in `packages/db/src/emit/alter-type.ts` plus one renderer. Future enum-related work touches one source of truth instead of scattered string-builds across `emit/pg.ts`. Output SQL is byte-identical to pre-refactor — existing snapshot tests + every adopter's `_journal.json` migration hash continue to lock the uppercase form.

Plan deviation worth flagging: the original M5.B.1 step described swapping to Kysely's typed `db.schema.alterType()` compiler directly. That compiler emits **lowercase** keywords (`alter type "foo" rename to ...`), which would silently break every adopter's migration hashes. Path taken instead: model Kysely's `AlterTypeNode` shape but render through the local emitter. Decision captured in PR #219's body.

`CreateDbClientOptions` gains an additive `plugins?: KyselyPlugin[]` field — adopter plugins append after the built-in chain (`CodecPlugin` for `customType` mappers, `ParseJSONResultsPlugin` for SQLite + MySQL JSON decoding). Useful for `CamelCasePlugin`, custom soft-delete filters, instrumentation.

The originally-planned `safeNullComparison()` wrapper was pulled — Kysely 0.29's `SafeNullComparisonPlugin` ships broken on PG (rewrites `=` to `IS` but keeps the null operand parameterised, producing `WHERE "col" IS $1` which PG rejects with `syntax error at or near "$1"`). Surfacing the wrapper would have replaced the silently-false `= NULL` footgun with a runtime parse error — arguably worse. Locked in `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts`; tracked for follow-up at #220.

## Internal hardening

### Upstream-bug evidence lock for Kysely's `SafeNullComparisonPlugin`

`packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts` boots PG 16 via Testcontainers and asserts the broken upstream behaviour as observed today. Four cases: raw-protocol probe of `WHERE col IS $1`, end-to-end via `createDbClient({ plugins: [new SafeNullComparisonPlugin()] })`, the explicit `'is'` / `'is not'` operators (the recommended workaround), and the silently-false `= null` zero-rows lock. When upstream fixes the transformer (likely by emitting a literal `NULL` instead of a `ValueNode`), one of the assertions will fail — that's the signal to re-introduce a kickjs-side wrapper.

## Out of scope (deferred to v5.8 / M6)

- **M5.C — connection-pool devtools tab.** Pure DX; doesn't block other work. The plan flagged it as movable to M6 if higher-priority work surfaced; the `RequestContext.signal` gap surfaced and consumed the slot.
- **Hardening suite from the original architecture spec §13** — benchmarks against drizzle / prisma / raw `pg` on read/write/transaction microbenchmarks (target: within 10% of `pg`-direct on simple selects, within 25% on `with`-joins), fuzz the diff engine (1000 random schema-pair fixtures), migration replay test (every committed migration → apply → reverse → re-apply → schema identical), threat-model SQL emission. None landed in M5. The "production-grade" claim from the architecture spec still depends on these — slot them as the M6 gate before v6.0.0 GA.
- **`SafeNullComparisonPlugin` wrapper re-introduction.** Tracked at #220; lives behind the upstream fix.

## Versions

- `@forinda/kickjs-db`: **patch** (M5.A.1 DEFAULT fix) + **minor** (M5.A.2 AbortSignal + new error class) + **minor** (M5.A.3 ReadonlyKysely re-export) + **minor** (M5.B ALTER TYPE refactor + `plugins?` opt-in). Net: minor.
- `@forinda/kickjs-db-pg`: **patch** (test-only — the upstream-bug evidence lock).
- `@forinda/kickjs`: **minor** (additive `RequestContext.signal` getter).

`workspace:^` peer ranges (PR #207) plus `onlyUpdatePeerDependentsWhenOutOfRange: true` keep the peer adapters off the cascade — `db-sqlite` and `db-mysql` don't bump in this milestone.

## Numbers

- `@forinda/kickjs-db`: **392 tests** (was 365 at M4 cut, 379 pre-M5, 386 at M5.A.3, 392 at M5.B with five wrapper-related cases removed in the fixup).
- `@forinda/kickjs-db-pg`: **32 tests** (was 24 at M4, 28 at M5.A.2, 32 at M5.B with the upstream-bug evidence lock).
- `@forinda/kickjs`: **406 tests** (+6 new `RequestContext.signal` cases on top of the M5.A.2 baseline).
- Bundle-size delta gate: **7.40 KB** (floor 1 KB) — unchanged; no devtools-tab additions to this milestone (M5.C deferred).
