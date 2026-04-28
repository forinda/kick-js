# TanStack patterns — what to borrow for `@forinda/kickjs-db` + KickJS

> Status: research notes (2026-04-27)
> Sources: local checkouts at `/home/forinda/dev/open-source/{tanstack-query,tanstack-router,tanstack-db,tanstack-devtools}`
> Audience: contributors planning M2 of `@forinda/kickjs-db` and the broader KickJS ecosystem

This doc captures patterns from the four mature TanStack repos that are worth porting,
ordered by **how soon they should land**:

1. [What we already do well](#what-we-already-do-well-validated-by-tanstack) — patterns that map almost 1:1 onto our current shape; the takeaway is "stay the course".
2. [Borrow now (low-effort, high-value)](#borrow-now) — decisions we should make in M2 / v6.0.
3. [Borrow soon (M2–M3 alignment)](#borrow-soon) — bigger shifts that change the spec.
4. [Borrow eventually (M3+)](#borrow-eventually) — patterns worth tracking but not blocking.

Tags `[DB]` / `[FRAMEWORK]` / `[BOTH]` indicate whether a pattern lands in
`@forinda/kickjs-db` specifically, in the broader KickJS framework, or both.

---

## What we already do well (validated by TanStack)

These confirm directional choices already in our spec — no action needed beyond noting
the precedent.

### 1. Decouple core from framework adapters [BOTH]

TanStack Query's `query-core` has zero React, zero Vue. Framework adapters (`react-query`,
`vue-query`) wrap core with hooks/composables. Same shape as our split between
`@forinda/kickjs-db` (DSL + diff + runner + Kysely client) and `@forinda/kickjs-db-pg`
(driver-bound `MigrationAdapter`). Same shape as KickJS framework: adapter packages
ship `defineAdapter()` factories that wire into the bootstrap lifecycle.

**Verdict:** stay the course. The package boundary is right.

### 2. No-fork extension via callbacks + subscriptions [FRAMEWORK]

TanStack Query plugins (`query-async-storage-persister`, `query-broadcast-client`)
observe via `queryCache.subscribe(listener)` and mutate via public cache methods.
No interface inheritance. No sealed internals. Just function contracts.

KickJS's `defineAdapter` / `definePlugin` factories already follow this — adopters
implement option callbacks (`beforeStart`, `shutdown`, `introspect`), no class-extends.

**Verdict:** continue resisting class hierarchies; lean harder into "callback contract"
in M2 docs.

### 3. Sync source adapter contract is sound [DB]

TanStack DB's `SyncConfig` interface for sync sources is structurally near-identical to
our `MigrationAdapter`:

| Concept               | TanStack DB `SyncConfig`                                                   | KickJS `MigrationAdapter`                                 |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Lifecycle hook        | `sync({ collection, begin, write, commit, markReady, truncate })`          | `ensureMigrationTables() / applySqlInTx() / introspect()` |
| Provider plug-ins     | `query-db-collection`, `electric-db-collection`, `powersync-db-collection` | `db-pg`, future `db-sqlite`, `db-mysql`, `db-d1`          |
| Caller-owned resource | Adapter doesn't own the source                                             | `pgAdapter` doesn't own the pool — caller does            |

**Verdict:** the M0/M1 design choice (`MigrationAdapter` as a slim, driver-shaped contract)
is the same call TanStack DB made for sync sources. Validated.

### 4. Build-time codegen + post-hoc inference [FRAMEWORK]

TanStack Router emits `routeTree.gen.ts` with three indexed surface types
(`FileRoutesByFullPath`, `FileRoutesById`, `FileRoutesByTo`) that consumer code reads via
generic threading without manual import.

KickJS already does this for routes, env, and assets via `kick typegen`
(`KickRoutes` / `KickEnv` / `KickAssets` ambient augmentations).

**Verdict:** already aligned. The next step (M2-S1) is to extend the same model to a
`KickDbSchema` ambient — see [Borrow soon §1](#1-tighten-schematokysely-via-phantom-type-tagging-db).

### 5. PendingMutation shape is the right model for migration state [DB]

TanStack DB's `PendingMutation<T>` carries `{ original, modified, changes, optimistic }`
with discriminated `ResolveTransactionChanges<T, TOperation>` so insert/update/delete
each get the right `changes` shape. Optimistic apply + auto-rollback on throw.

This maps **exactly** to our migration runner's apply→record→rollback loop. It's the
right model for the planned `kick db migrate review <id>` workflow that should track
"in-progress reviews" without committing them yet.

**Verdict:** when we build `migrate review` and the v6.1 transaction-aware extension
points (M2-S6 lifecycle hooks for `transactionStart`/`Rollback`), use TanStack DB's
`PendingMutation` shape as the reference, not invent fresh names.

---

## Borrow now

### 1. Standard Schema (`~standard`) — accept any validator [BOTH]

**Currently:** KickJS hard-locks to Zod (`zod` is a peer dep of `@forinda/kickjs`).
`@Body` decorator and `validate()` middleware use Zod schemas.

**TanStack DB pattern:** Collections accept any validator implementing the
[Standard Schema spec](https://github.com/standard-schema/standard-schema) via the
`~standard` marker:

```ts
// tanstack-db/packages/db/src/collection/mutations.ts:65-72
if (schema && `~standard` in (schema as {})) {
  return schema as StandardSchema<TOutput>
}
```

That single check unlocks **Zod, Valibot, ArkType, Effect Schema** — every modern
validator implements the spec. The collection extracts `InferSchemaInput<T>` and
`InferSchemaOutput<T>` for free, without locking the user's choice.

**What to do:**

- **kickjs-db:** Already on the right side — we don't take a validator at all (the schema
  is TS code-first). But for the planned `customType<T>({ validate })` mapper (M2-S5)
  and the future `defineCollection({ schema })` query API, accept any Standard Schema
  validator instead of typing `validate: (v: unknown) => T`.
- **KickJS framework (urgent):** This is a real lock-in. `@Body(MySchema)` should accept
  any Standard Schema, not require Zod. Concrete change:

  ```ts
  // before
  export function validateBody<T extends z.ZodTypeAny>(schema: T) { ... }

  // after
  export function validateBody<T extends StandardSchemaV1>(schema: T) { ... }
  ```

  Document `@forinda/kickjs` peer dep on Zod as **optional**; recommend Zod by default
  but support Valibot for tiny edge bundles, ArkType for nominal-typed apps. Removes a
  major future complaint.

**Effort:** ~2 days. **Reach:** every adopter who's currently muttering about Zod.

### 2. Devtools plugin contract: `(el, props) => void` [BOTH]

**Currently:** Our `defineDevtoolsTab` from `@forinda/kickjs-devtools-kit` (per spec)
returns an object with framework-specific render hooks.

**TanStack pattern:** Every plugin implements one render function:

```ts
interface TanStackDevtoolsPlugin {
  id?: string
  name: string | ((el: HTMLElement, props: PluginProps) => void)
  render: (el: HTMLElement, props: PluginProps) => void
  destroy?: (pluginId: string) => void
  defaultOpen?: boolean
}
```

The plugin author gets a raw `HTMLDivElement` and renders into it however they want
(Solid, vanilla DOM, hyperscript, lit-html). The host shell is framework-agnostic
because it never imports React/Vue — it just hands an element to the plugin.

**What to do:** Refactor `defineDevtoolsTab` to this contract before v6.0. Existing tabs
(`devtools-kit` consumers) get a thin migration layer. New plugin authors learn one
API. Means our DevTools dashboard at `/_debug` can host third-party plugins (e.g.,
`@forinda/kickjs-prisma`-shipped tab) without us needing to know their UI framework.

**Effort:** ~1 week. **Reach:** every adapter package author + adopters who want to ship
their own custom tabs.

### 3. Vite plugin: strip devtools from prod via AST transform [BOTH]

**Currently:** `kickDbAdapter` checks `NODE_ENV !== 'production'` at runtime to disable
write controls. The DevTools UI assets still ship in the bundle.

**TanStack pattern:** `@tanstack/devtools-vite` runs a Babel transform during prod
build that:

- Removes `import` statements matching `@tanstack/react-devtools`, `@tanstack/devtools`, etc.
- Removes JSX `<TanStackDevtools />` elements + unused references
- Optional `requireUrlFlag: 'tanstack-devtools'` so devtools only mount when the URL
  contains the flag (useful for staging diagnostics)

```ts
// tanstack-devtools/packages/devtools-vite/src/plugin.ts:106
removeDevtoolsOnBuild?: boolean // default true
```

**What to do:** Ship `@forinda/kickjs-vite/devtools-strip` (an additional Vite plugin
exported from the existing `@forinda/kickjs-vite` package, not a new package) that strips
`import '@forinda/kickjs-devtools'` and `<KickJsDevtools />` JSX from production builds.
Adopters opt in with one line in `vite.config.ts`. Bundles shrink by tens of KB; no
risk of devtools state leaking to production.

**Effort:** ~3 days. **Reach:** every kickjs adopter who deploys to a size-conscious
runtime (edge, bundles).

---

## Borrow soon

These are bigger shifts — they change the spec or land a new package. Plan them into
M2 explicitly.

### 1. Tighten `SchemaToKysely` via phantom-type tagging [DB]

**Currently:** M1's `SchemaToKysely<S>` is permissive — every column type is `unknown`.
M2-S1 was always going to tighten this. The TanStack pattern shows the cleanest path.

**TanStack Query technique:** `dataTagSymbol` and `dataTagErrorSymbol` are unique symbol
phantoms attached to query keys. `InferDataFromTag<TQueryFnData, TTaggedQueryKey>` pulls
the data type **from the key**, not from the function signature. The user writes
`['user', id] as const` and TS infers `data: User` end-to-end.

```ts
// tanstack-query/packages/query-core/src/types.ts (excerpt)
declare const dataTagSymbol: unique symbol
declare const dataTagErrorSymbol: unique symbol
type DataTag<TKey, TData, TError> = TKey & {
  [dataTagSymbol]: TData
  [dataTagErrorSymbol]: TError
}
```

**Apply to kickjs-db:** Tag each `ColumnBuilder` instance at the type level with its
inferred TS type. The current builder runtime stores no type info — purely a phantom
generic `ColumnBuilder<T>`. Then:

```ts
// proposed
export class ColumnBuilder<T = unknown> {
  // runtime unchanged
  // type: phantom T threads through .notNull(), .default(), .references()
}

export function varchar(length: number): ColumnBuilder<string> { ... }
export function integer(): ColumnBuilder<number> { ... }
export function jsonb<T>(): ColumnBuilder<T> { ... }
```

`SchemaToKysely<S>` becomes a distributive conditional that picks each column's `T` via
`infer`:

```ts
type ColumnTSType<C> = C extends ColumnBuilder<infer T> ? T : never
type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<any> ? S[K]['__name'] : never]: S[K] extends TableDecl<
    infer C
  >
    ? { [Col in keyof C]: ColumnTSType<C[Col]> }
    : never
}
```

Result: `db.insertInto('users').values({ email: 'x@y.z' })` typechecks without the
`as never` cast in our M1 example app's repositories.

**Note on `NoInfer<T>`:** TanStack uses `NoInfer<TData>` in `useQuery` overloads to
prevent co-variance bugs where `TData` would widen incorrectly when both options and a
`select` callback are passed. Use `NoInfer<T>` in our `$extends({ result })` API
(M2-S6) where the same widening can happen — column type from `needs` should not be
widened by the `compute` return type.

**Effort:** Locked in for M2-S1 (estimated 1 week). No scope change; just confirms the
right technique.

### 2. Live query / IVM-style invalidation, scoped to listener pattern [DB]

**TanStack DB:** `useLiveQuery((q) => q.from(...).where(...))` returns reactive results
via incremental view maintenance — push-based delta updates. Mandatory `orderBy` for
`limit`, equality-only joins.

**Apply to kickjs-db:** We don't need full IVM in M2 — server-side ORM, not client cache.
But the **listener pattern** maps directly onto our M2 `db.on('query'|'queryError'|...)`
events:

```ts
// adopter writes
db.on('query', ({ table, op, durationMs }) => metrics.observe(...))
db.on('queryError', ({ sql, error }) => sentry.captureException(error))
```

This is just the Kysely query-emit pipeline we already plan to build in M2-S6. The
TanStack DB pattern adds two specifics worth borrowing:

1. **Mandatory `orderBy` for `limit`** as a contract — undefined ordering + paging is
   a bug source. We should warn (not error) when `selectFrom().limit(n)` is used without
   `orderBy()`. Document why.
2. **IVM constraint awareness** — equality-only joins, `having` requires `groupBy`,
   `distinct` requires `select`. These are guard rails worth documenting in the
   `kickjs-db` query guide even though Kysely doesn't enforce them at the type level.

**Effort:** ~1 day for warnings + docs. The full event pipeline is already in M2-S6.

### 3. Tuple-prefix matching for hierarchical keys [DB] / [FRAMEWORK]

**TanStack Query:** `invalidateQueries({ queryKey: ['user'] })` matches `['user', 1]`,
`['user', 2]`, etc. Implementation:

```ts
// tanstack-query/packages/query-core/src/utils.ts
type TuplePrefixes<T extends ReadonlyArray<unknown>> = ...
function matchQuery({ queryKey: filter, exact }, query) {
  if (exact) return hashKey(filter) === hashKey(query.queryKey)
  return partialMatchKey(filter, query.queryKey)
}
```

**Apply to kickjs-db:** Useful when we add a query result cache (post-M2). E.g.,
`db.invalidate(['users'])` invalidates every cached query whose key starts with
`['users', ...]`. Mirrors how prisma's `select` cache works.

**Apply to KickJS framework:** Slash-delimited DI tokens (`'kick/db/primary'`,
`'app/users/repository'`) are already structural-prefix friendly. Could expose:

```ts
container.invalidateScope('app/users') // re-resolves every app/users/* token
container.list('kick/') // diagnostic: every first-party-registered token
```

Currently the container is name-keyed but doesn't expose prefix queries. ~3 days to add.

### 4. Multi-tier event bus for DevTools IPC [BOTH]

**TanStack DevTools:** `BroadcastChannel('tanstack-devtools')` for cross-tab sync,
WebSocket for client↔server, SSE fallback when WS unavailable, port `4206` by default.
Vite plugin injects globals (`__TANSTACK_DEVTOOLS_PORT__`) so the client knows where
to connect.

**Apply to KickJS framework:** Our DevTools dashboard at `/_debug` is currently same-page
only. Adding cross-tab sync (open `/_debug` in two tabs, see the same state) is one
`BroadcastChannel` away. Adding a server→browser feed (HMR-driven query events show up
live in DevTools without refresh) is one WebSocket route plus a tiny client.

Concrete shape:

```ts
// in @forinda/kickjs-devtools
export class KickDevtoolsBus {
  private bcast = new BroadcastChannel('kick-devtools')
  private ws?: WebSocket
  // emit(event) routes to bcast (cross-tab) AND ws (server→client)
  // on(type, handler) — receives from either channel
}
```

KickJS's existing logger could route relevant events through it (slow query, migration
applied, request error). Adopter sees them in the DevTools panel without touching their
own code.

**Effort:** ~1 week for the core; another for first-party tabs to consume it. Worth it
once we have multiple DevTools tabs that benefit from cross-tab persistence.

### 5. The "TanStack Start" full-stack pattern [BOTH]

**TanStack Start:** Server functions wrapped with metadata:

```ts
// tanstack-router/packages/start-server-core/src/createServerRpc.ts
const serverFn = (impl) =>
  Object.assign(client, {
    id,
    url,
    [TSS_SERVER_FUNCTION]: true,
  })
```

Client calls resolved via `splitImportFn`. Type inference: server function signature
flows to client call site via TS module augmentation. **No explicit RPC type
definitions needed.**

**Apply to KickJS framework:** Once we get to KickJS's planned RPC / form-action /
server-function story (post-v6), this is the model. Don't invent a parallel naming
convention; copy `[TSS_SERVER_FUNCTION]` symbol metadata exactly. Saves us a year of
discovering edge cases.

**Effort:** Roadmap item, not M2. Track but don't block.

---

## Borrow eventually

### 1. Replay / time-travel for migrations [DB]

TanStack DevTools doesn't have time-travel in core (real-time event bus only) but
TanStack Query Devtools does — replay a query's state at any point. KickJS-DB could
add a similar replay for migrations: "show me the schema state at migration X".

We already have it semantically — every migration carries `snapshot.json`. The DevTools
tab just needs to render it. Worth adding once the user base asks.

### 2. Pluggable file-based generator [FRAMEWORK]

TanStack Router's `router-generator` walks the file system and emits typed augmentations.
KickJS's `kick typegen` does similar work for routes/env/assets. The next step (year-out)
is **pluggable generators** — adopters register transforms that contribute to the typegen
output.

Concrete shape from the spec:

```ts
// kick.config.ts
export default defineConfig({
  typegen: {
    plugins: [openApiTypegenPlugin(), graphqlTypegenPlugin()],
  },
})
```

This is what makes a framework an ecosystem instead of a tool. Track but not for v6.0.

### 3. Persistence/replay of DevTools state [BOTH]

TanStack persists active plugins, panel position, theme to localStorage with two keys:
`TANSTACK_DEVTOOLS_SETTINGS` and `TANSTACK_DEVTOOLS_STATE`. Stale plugin IDs are
auto-pruned on next load. Should mirror exactly when our DevTools UI matures.

---

## Cross-cutting design lessons

A couple of techniques that don't map to a specific feature but show up across all
four TanStack repos and are worth internalising:

### `Register` interface augmentation pattern [FRAMEWORK]

TanStack lets users type their entire app once via:

```ts
// adopter app
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

Then `<Link to=...>` everywhere autocompletes routes from `router`'s type, with no
explicit annotation. KickJS already uses ambient augmentation for `KickRoutes` and
friends. We should adopt the **named `Register` interface convention** so adopters
write:

```ts
declare module '@forinda/kickjs-db' {
  interface Register {
    db: typeof appDb
    schema: typeof appSchema
  }
}
```

Then `@Inject(DB_PRIMARY) private db!: KickDbClient` widens automatically to the typed
`Db` we're currently casting via `as Db` in our example app. Removes the M1-permissive
cast for adopters who opt in.

### Discriminated config unions to forbid invalid combinations [BOTH]

TanStack DB:

```ts
type StringCollationConfig =
  | { stringSort?: 'lexical' }
  | { stringSort?: 'locale'; locale?: string; localeOptions?: object }
```

`locale` only valid when `stringSort === 'locale'`. Compile-time check, no runtime
validation needed.

**Apply broadly:** Wherever our config has interdependent fields (e.g., `kickDbAdapter`'s
`migrationsOnBoot: 'fail-if-pending'` with `requireReviewed: false` is nonsensical),
prefer a discriminated union over a flat options bag. Spec needs a sweep when M2 is
designed.

### Prevent generic union widening with `Omit` + intersection [DB]

TanStack DB's `TransactionWithMutations` uses:

```ts
type TransactionWithMutations<T> = Omit<Transaction<T>, 'mutations'> & {
  mutations: NonEmptyArray<...>
}
```

…to prevent TS from widening `TOperation` when intersecting an array. Niche but useful
when our `$extends({ result })` API needs to refine `mutations` on a per-table basis
without infecting the parent transaction type.

---

## Summary table

| Pattern                                        | Tag         | Where to land                                     | Effort          | Priority |
| ---------------------------------------------- | ----------- | ------------------------------------------------- | --------------- | -------- |
| Standard Schema validator binding              | [BOTH]      | `@forinda/kickjs` `@Body`; kickjs-db `customType` | 2d              | **now**  |
| Devtools plugin contract `(el, props) => void` | [BOTH]      | `@forinda/kickjs-devtools-kit`                    | 1w              | **now**  |
| Vite AST strip for prod                        | [BOTH]      | `@forinda/kickjs-vite/devtools-strip`             | 3d              | **now**  |
| Phantom-type column tagging                    | [DB]        | M2-S1                                             | already planned | M2       |
| `NoInfer<T>` on `$extends` overloads           | [DB]        | M2-S6                                             | 1d              | M2       |
| `Register` interface augmentation              | [BOTH]      | M2-S1 alongside types tighten                     | 2d              | M2       |
| `orderBy` warning for `limit`                  | [DB]        | M2-S6 docs + warning                              | 1d              | M2       |
| Discriminated union config                     | [BOTH]      | spec sweep                                        | 1w              | M2       |
| Tuple-prefix DI scope queries                  | [FRAMEWORK] | KickJS Container                                  | 3d              | M2/M3    |
| Multi-tier DevTools event bus                  | [BOTH]      | M3                                                | 1–2w            | M3       |
| Replay/time-travel for migrations              | [DB]        | post-M3                                           | 2w              | later    |
| Pluggable typegen                              | [FRAMEWORK] | year-out                                          | large           | later    |

The first three (Standard Schema, plugin contract, Vite strip) are the highest
leverage. Plan them into v6.0 explicitly so we don't ship incompatible APIs that we
have to break later.
