# Spec: Automatic schema type augmentation for `@forinda/kickjs-db`

> Status: Draft v1
> Date: 2026-04-27
> Owner: @forinda
> Target: M2 — replaces the M1-permissive `unknown` shape in `SchemaToKysely`
> Sibling specs: [`./architecture.md`](./architecture.md), [`./m1-plan.md`](./m1-plan.md), [`./tanstack-patterns.md`](./tanstack-patterns.md)

## 1. Problem statement

Today, an adopter using `@forinda/kickjs-db` (M1) writes their schema **once** in TypeScript:

```ts
// src/db/schema.ts
export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  isActive: boolean().notNull().default('true'),
})
```

…and then has to **redeclare those column types** by hand to get a typed query layer:

```ts
// src/db/client.ts (current M1 state — examples/task-kickdb-api)
interface DB {
  users: {
    id: string
    email: string
    isActive: boolean
  }
  // …repeat for every table, every column
}

export const dbClient = createDbClient<typeof schema, DB>({
  schema,
  dialect: new PostgresDialect({ pool }),
})
```

This is a **drift trap**. The day someone:

- adds a column to `users` and forgets to add it to `interface DB`,
- changes `varchar(255)` to `text()` (no runtime change but should be `string` either way; bad if it's `Buffer`),
- reverses a `nullable` flag,

…the schema and the types diverge. Compile-time errors surface inconsistently because the
field exists in one source-of-truth and not the other.

KickJS already has a precedent for "types follow the source of truth automatically" via
[`kick typegen`](../guide/typegen.md) emitting `KickRoutes`, `KickEnv`, `KickAssets`
ambient augmentations. The DB layer should follow the same pattern.

This spec covers **automatic schema type inference + augmentation** so adopters never
hand-write a column type. A new column in `schema.ts` is a typed column at every call
site, with no manual step.

## 2. Goals

1. **Zero hand-written column types.** The TS schema is the only source of truth.
2. **No explicit generic call site.** Adopter writes `db.selectFrom('users')` and gets
   typed columns; nothing like `<typeof schema, ManualDB>` is required.
3. **Compile-time, not runtime.** Inference happens via TS generics + ambient
   augmentation; no runtime reflection on the schema.
4. **Optional codegen for cold-start speed.** Pure inference is the default; `kick db
typegen` is opt-in for projects with large schemas where instantiation pressure
   slows the IDE.
5. **Backwards compatible with M1.** The current `KickDbClient<DB = unknown>` surface
   remains; we just give adopters a way to fill in `DB` automatically.
6. **Same shape as `KickRoutes` / `KickEnv` / `KickAssets`.** Adopters who know
   `kick typegen` learn nothing new.

## 3. Non-goals

- **Auto-generating SQL types** (e.g., custom PG enum types). M3 territory.
- **Inferring relations into Kysely's `Database` type.** Relations stay `db.query.X`
  surface (M2-S4), not the Layer 1 typed Kysely interface.
- **Runtime reflection on column metadata.** Everything is type-level + opt-in codegen.
- **Cross-package automatic type sync** (e.g., adopter's controller types magically
  knowing schema types without an import). Adopter still writes `import type { User }
from '@/db/schema'` for hand-rolled DTOs.

## 4. Design overview

Three layers, each addressing a specific failure mode of the M1-permissive default:

| Layer                           | Solves                                                             | Mechanism                                              |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **L1. Phantom column tagging**  | "Does `varchar(255)` produce a `string` or `unknown`?"             | `unique symbol` phantoms on column builders            |
| **L2. `SchemaToKysely<S>`**     | "How does the schema record become Kysely's `Database` interface?" | Distributive conditional + `infer T`                   |
| **L3. `Register` augmentation** | "How does `KickDbClient` know which schema this app uses?"         | Module augmentation interface, mirrors TanStack Router |

Plus an **L4. Codegen escape hatch** — `kick db typegen` emits the same `Register`
augmentation as a `.kickjs/types/db.d.ts` file when adopters opt in.

```
    L4: kick db typegen           (opt-in cold-start speedup)
        │
        ▼
    L3: declare module 'app' { interface Register { db: ... } }
        │
        ▼  (consumed by KickDbClient<DB extends Register['db']>)
    L2: SchemaToKysely<S>          (S → Kysely Database type)
        │
        ▼  (consumes phantom T per column)
    L1: ColumnBuilder<T = unknown> (varchar(255) → ColumnBuilder<string>)
```

## 5. Layer 1 — Phantom column tagging

### Current shape

```ts
// packages/db/src/dsl/columns/types.ts (M1)
export class ColumnBuilder {
  protected state: ColumnState
  notNull(): this { ... }
  default(value: string): this { ... }
  primaryKey(): this { ... }
  unique(): this { ... }
  references(...): this { ... }
  array(): this { ... }
  toJSON(name: string): ColumnSnapshot { ... }
}
```

`ColumnBuilder` is generic-free. Every column collapses to the same type.

### Proposed shape

Add a phantom generic threaded through every chain method:

```ts
// packages/db/src/dsl/columns/types.ts (M2)
export class ColumnBuilder<T = unknown, TNullable extends boolean = true> {
  protected state: ColumnState
  // The phantom generic T flows through method signatures.

  notNull(): ColumnBuilder<T, false> {
    this.state.nullable = false
    return this as unknown as ColumnBuilder<T, false>
  }

  default(value: string): this { ... }
  primaryKey(): ColumnBuilder<T, false> { ... }   // PK implies NOT NULL
  unique(): this { ... }
  references<U>(target: () => { __builder: ColumnBuilder<U, any> }, opts?: ...): this { ... }
  array(): ColumnBuilder<T[], TNullable> {
    this.state.type = `${this.state.type}[]`
    return this as unknown as ColumnBuilder<T[], TNullable>
  }

  toJSON(name: string): ColumnSnapshot { ... }
}
```

Each column constructor declares its TS type:

```ts
// packages/db/src/dsl/columns/builders.ts (M2)
export function serial(): ColumnBuilder<number, false> {
  return new ColumnBuilder<number, false>('serial', { nullable: false })
}

export function bigSerial(): ColumnBuilder<bigint, false> {
  return new ColumnBuilder<bigint, false>('bigserial', { nullable: false })
}

export function integer(): ColumnBuilder<number> { ... }
export function bigint(): ColumnBuilder<bigint> { ... }
export function smallint(): ColumnBuilder<number> { ... }
export function decimal(p?: number, s?: number): ColumnBuilder<string> { ... }
export function numeric(p?: number, s?: number): ColumnBuilder<string> { ... }
export function real(): ColumnBuilder<number> { ... }
export function doublePrecision(): ColumnBuilder<number> { ... }

export function varchar(length = 255): ColumnBuilder<string> { ... }
export function char(length = 1): ColumnBuilder<string> { ... }
export function text(): ColumnBuilder<string> { ... }
export function uuid(): UuidBuilder { ... }   // extends ColumnBuilder<string>

export function boolean(): ColumnBuilder<boolean> { ... }

export function timestamp(): TimestampBuilder { ... }   // extends ColumnBuilder<Date>
export function timestamptz(): TimestampBuilder { ... }
export function date(): ColumnBuilder<Date> { ... }
export function time(): ColumnBuilder<string> { ... }
export function interval(): ColumnBuilder<string> { ... }

export function json<T = unknown>(): ColumnBuilder<T> { ... }
export function jsonb<T = unknown>(): ColumnBuilder<T> { ... }
export function bytea(): ColumnBuilder<Buffer> { ... }
```

The column constructor is the **only** place a TS type is hand-written, and it's the
package author writing it once per type, not the adopter.

### Subtype builders preserve the phantom

`TimestampBuilder extends ColumnBuilder<Date>` — `defaultNow()` returns `this`, which
narrows to `TimestampBuilder` and keeps `<Date>`. Same for `UuidBuilder<string>`.

### Custom column types

The M2-S5 `customType<T>()` mapper already takes a generic; it now flows into the
inferred row:

```ts
const encrypted = customType<string>({
  dataType: () => 'text',
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v as string),
})
// returns ColumnBuilder<string>
```

### Nullability dimension

The second generic `TNullable` is wired so `varchar(255).notNull()` returns
`ColumnBuilder<string, false>`. `SchemaToKysely<S>` reads it to decide `string` vs
`string | null` per column. Default is `true` (nullable, `string | null`).

### Cost of the change

Internal-only. Runtime is identical. The cast `as unknown as ColumnBuilder<T, false>`
is once per chain method; there is no observable JS difference.

## 6. Layer 2 — `SchemaToKysely<S>`

### Current shape (M1-permissive)

```ts
// packages/db/src/client/schema-types.ts (M1)
export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C>
    ? { [Col in keyof C]: unknown } // ← every column collapses to unknown
    : never
}
```

### Proposed shape

Distribute into each column, infer the phantom `T`, fold in `TNullable`, and wrap
auto-generated columns in Kysely's `Generated<T>` so adopters can `INSERT` without
specifying `id`:

```ts
// packages/db/src/client/schema-types.ts (M2)
import type { Generated } from 'kysely'
import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * The columns we treat as DB-generated by default — `serial`, `bigserial`,
 * `smallserial`, and `uuid().defaultRandom()` columns. Wrapping their TS type in
 * Kysely's `Generated<T>` makes them optional on insert and present on select.
 */
type IsGenerated<C> =
  C extends ColumnBuilder<infer _T, infer _N>
    ? C extends { __isGenerated: true }
      ? true
      : false
    : false

type ColumnTSType<C> =
  C extends ColumnBuilder<infer T, infer Nullable>
    ? Nullable extends true
      ? T | null
      : IsGenerated<C> extends true
        ? Generated<T>
        : T
    : never

export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C> ? { [Col in keyof C]: ColumnTSType<C[Col]> } : never
}
```

The `IsGenerated<C>` check reads a marker we attach at the column-builder level:

```ts
// packages/db/src/dsl/columns/builders.ts (M2)
export function serial(): ColumnBuilder<number, false> & { __isGenerated: true } {
  const col = new ColumnBuilder<number, false>('serial', { nullable: false })
  ;(col as any).__isGenerated = true // type-only marker
  return col as ColumnBuilder<number, false> & { __isGenerated: true }
}
```

`uuid().defaultRandom()` produces a similar type via `UuidBuilder`'s phantom override.

### Result

```ts
import { table, serial, varchar, boolean, integer } from '@forinda/kickjs-db'

export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
  isActive: boolean().notNull().default('true'),
  signupCount: integer(), // nullable
})

type DB = SchemaToKysely<{ users: typeof users }>
//   ^? {
//        users: {
//          id: Generated<number>           // optional on insert, present on select
//          email: string                   // notNull → no | null
//          isActive: boolean               // notNull → no | null
//          signupCount: number | null      // default nullable
//        }
//      }
```

Adopter writes the schema. Types fall out.

## 7. Layer 3 — `Register` interface augmentation

### Why

Even with L1+L2, the adopter still has to call `createDbClient<typeof schema>(...)`
explicitly to thread `S` through. We can do better: a **module-augmented `Register`
interface** that the adopter declares once, and every consumer reads through.

### Pattern (mirrored from TanStack Router)

The package ships an empty `Register` interface. The adopter declares:

```ts
// app/src/db/register.ts (or anywhere — the whole-program type system picks it up)
import type { dbClient } from './client'

declare module '@forinda/kickjs-db' {
  interface Register {
    db: typeof dbClient
  }
}
```

`KickDbClient` becomes:

```ts
// packages/db/src/client/types.ts (M2)
export interface Register {
  // empty by default; adopters augment via module declaration
}

type RegisteredDb = Register extends { db: infer D } ? D : never

export interface KickDbClient<DB = ResolveRegisteredDB> {
  // …existing surface…
}

type ResolveRegisteredDB = RegisteredDb extends KickDbClient<infer X> ? X : unknown
```

Now `@Inject(DB_PRIMARY) private db!: KickDbClient` gives the adopter the typed
`KickDbClient<typeof schema>` automatically — no explicit generic, no manual cast.

### Multi-DB apps

Apps with `DB_PRIMARY` + `DB_REPLICA` (different schemas) declare both keys:

```ts
declare module '@forinda/kickjs-db' {
  interface Register {
    db: typeof primaryDb
    primary: typeof primaryDb
    replica: typeof replicaDb
  }
}
```

…and key the resolver off the token name:

```ts
// in the package
type RegisteredFor<TokenName extends string> = Register extends Record<TokenName, infer D> ? D : never

// constructor pattern (M2)
@Inject(DB_PRIMARY) private db!: KickDbClient<RegisteredFor<'primary'>>
```

Or, more ergonomically, ship a `TypedToken<KeyName>` helper that does this lookup
internally. Detailed design at M2 time.

### Failure mode

If the adopter forgets to write the `declare module` block, `KickDbClient` falls back
to `unknown`-per-column (current M1 behaviour). No regression. The augmentation is
opt-in.

## 8. Layer 4 — `kick db typegen` (opt-in codegen)

For most projects, L1+L2+L3 is enough. The adopter writes `schema.ts`, declares
`Register`, and TS does the rest at compile time. **No codegen.**

For two adopter pain points, codegen helps:

1. **Cold-start speed in large schemas.** Once a project has 30+ tables, TS spends a
   noticeable amount of time instantiating `SchemaToKysely<S>` per file that touches
   the client. Codegen pre-computes it.
2. **Discoverability for the `Register` augmentation.** New adopters miss the
   `declare module` step, get fallback `unknown` types, and don't know why. Codegen
   writes the augmentation file for them.

### Shape of the codegen

`kick db typegen` (analog to `kick typegen` for routes/env/assets):

1. Read `kick.config.ts` for `db.schemaPath`.
2. Import the schema module.
3. Walk the exported tables, materialise `SchemaToKysely<typeof schema>` to a concrete
   TS type.
4. Emit `.kickjs/types/db.d.ts`:

   ```ts
   /// <auto-generated by kick db typegen — DO NOT EDIT >
   declare module '@forinda/kickjs-db' {
     interface Register {
       db: KickDbClient<KickDbSchema>
     }
   }

   declare global {
     interface KickDbSchema {
       users: {
         id: Generated<number>
         email: string
         isActive: boolean
         signupCount: number | null
       }
       workspaces: {
         /* … */
       }
     }
   }
   ```

5. Re-run on schema file changes (Vite HMR-aware; integrates with the existing typegen
   watcher in `@forinda/kickjs-vite`).

### Why a separate `kick db typegen` rather than folding into `kick typegen`

Two separate concerns; avoid coupling the route-typegen lifecycle to a DB connection.
Adopters who don't use kickjs-db never run it. The two commands sit alongside in
`packages/cli/src/commands/typegen.ts`.

### Output location consistency

`.kickjs/types/db.d.ts` matches the existing `.kickjs/types/{routes.d.ts, env.d.ts,
assets.d.ts}` convention. Single gitignore rule already covers the directory.

## 9. Migration from M1

### Adopter migration path

| Stage                            | Adopter code                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1 today**                     | Manual `interface DB { users: { id: string; … } }`; `createDbClient<typeof schema, DB>(...)`                                                        |
| **M2 inference-only**            | Drop the `DB` interface; `createDbClient(...)` infers from `typeof schema`                                                                          |
| **M2 + Register**                | One-line `declare module '@forinda/kickjs-db' { interface Register { db: typeof dbClient } }`; everywhere else, `KickDbClient` widens automatically |
| **M2 + typegen (large schemas)** | `pnpm db:typegen` runs once; emits `.kickjs/types/db.d.ts`; the `declare module` block disappears from adopter code                                 |

Each stage is **opt-in**. A project upgrading from M1 to M2 with no other changes
keeps working — `KickDbClient<unknown>` is still the default fallback.

### Internal migration tasks (M2-S1 reframed)

This spec replaces the M1-permissive plan in `m1-plan.md` task 19b's
`schema-types.ts`. The full M2-S1 task now:

1. Add phantom `<T, TNullable>` to `ColumnBuilder` (Layer 1). Cost: ~1 day. No runtime
   change. Test: `expectTypeOf(varchar(255).notNull()).toEqualTypeOf<ColumnBuilder<string, false>>()`.
2. Mark generated columns (`serial`, `bigSerial`, `smallSerial`,
   `uuid().defaultRandom()`) with `__isGenerated: true` type marker. Cost: ~half day.
3. Rewrite `SchemaToKysely<S>` per Layer 2. Cost: ~1 day. Test: full
   `expectTypeOf` pass against the existing `examples/task-kickdb-api` schema —
   `id` is `Generated<string>`, `email` is `string`, `signupCount` is `number | null`.
4. Add `Register` interface in `client/types.ts`; rewire `KickDbClient`'s default
   generic to resolve through it. Cost: ~half day. Test: in a TS-only test file,
   declare a fake `Register` augmentation and verify `selectFrom` typechecks.
5. Update the `examples/task-kickdb-api` to drop the manual `interface DB` and add the
   `declare module` block. Demonstrates the migration path. Cost: ~half day.
6. (Stretch — could ship after) `kick db typegen` command. Cost: ~3 days. Watch mode
   (~1 day more). Adds a typed cold-start speedup; not on the critical path.

Total without typegen: ~3 days. With typegen: ~7 days. Fits inside M2's 3-week
window for the type story (M2-S1 + S2).

## 10. Open questions

### 10.1 `Generated<T>` vs `ColumnDefault<T>` vs `Insertable<T>`

Kysely has three related helpers:

- `Generated<T>` — DB-assigned (serial, identity column). Optional on insert, always present on select.
- `GeneratedAlways<T>` — DB-assigned and **immutable**. Same as `Generated` but rejected at type level on update.
- `ColumnType<S, I, U>` — three-way split: select / insert / update.

Spec proposes `Generated<T>` for `serial` / `bigserial` / `smallserial` / `uuid().defaultRandom()` — they're auto-assigned but updateable.

`Date` columns with `defaultNow()` are an interesting case: insert-optional, but updateable. `Generated<Date>` is correct.

`integer().default('0')` — insert-optional too. We need a marker for "has runtime default" similar to `__isGenerated` but for any default. Probably worth a `__hasDefault: true` marker that wraps in `Generated<T>` too. To consider during M2-S1 implementation.

### 10.2 Type names that aren't available at value time

`bytea()` returns `ColumnBuilder<Buffer>`, but `Buffer` is a Node-only global. In an
edge runtime build, `Buffer` is unavailable. Options:

- Use `Uint8Array` instead (universal). Slight friction for adopters who want Buffer's
  string methods.
- Branded type `KickBytes` that is `Buffer` in node and `Uint8Array` on edge.

Pick during M2 when the edge entry (`@forinda/kickjs-db/edge`) lands.

### 10.3 Custom JSON shape inference for `jsonb<T>`

`jsonb<{ tags: string[] }>()` already works at the column level (M1). Question: when
that column appears in a select result, should the inferred type be **read-only** (no
mutations against the cached row) or mutable? Drizzle goes mutable; Prisma goes
read-only. We default to the schema's input shape unaltered (mutable).

### 10.4 Codegen vs ambient — pick one or both

Layer 3 (Register augmentation) and Layer 4 (codegen) overlap — codegen _generates_
the augmentation. Adopter could in theory choose either. Spec proposes:

- **Default**: ship Layer 1+2+3. Adopter writes the one-line `declare module` block.
- **Codegen**: opt-in via `kick.config.ts: db.typegen: true`. Replaces the manual
  `declare module` with the `.kickjs/types/db.d.ts` file. Idempotent — running
  typegen on a project that already has the manual block yields a build warning.

Two paths to the same result; adopter picks based on schema size + tooling preference.

## 11. Summary

The "tables augment the typed surface for users" outcome is achieved via four layers:

1. **Phantom column tagging** (`ColumnBuilder<T, TNullable>`) — schema columns carry
   their TS type at the type level.
2. **`SchemaToKysely<S>`** — distributive conditional pulls each column's `T` and
   nullability into a Kysely `Database` shape, wrapping generated columns in
   `Generated<T>`.
3. **`Register` interface augmentation** — adopter declares once, every `KickDbClient`
   call site widens to the typed shape with no manual generic call.
4. **`kick db typegen` (opt-in)** — for large schemas, codegen pre-computes the type
   and writes the augmentation file.

The user never types a column type by hand. Adding a column to `schema.ts` is a typed
column at every call site. Removing one breaks compilation everywhere it was used.
That's the contract we want.

The mechanism is **the same** as the existing `kick typegen` for routes/env/assets,
ported to the DB schema. Adopters who already use `KickRoutes` learn nothing new.

---

## Appendix A — sketch of the M1→M2 diff for the example app

The migration in `examples/task-kickdb-api/src/db/client.ts` becomes:

```ts
// before (M1)
interface DB {
  users: {
    id: string
    email: string
    firstName: string
    lastName: string
    avatarUrl: string | null
    isActive: boolean
    createdAt: Date | string
  }
  workspaces: {
    /* … */
  }
  tasks: {
    /* … */
  }
}

export const dbClient: KickDbClient<DB> = createDbClient<typeof schema, DB>({
  schema,
  dialect,
  events: true,
})
```

```ts
// after (M2 inference-only)
export const dbClient = createDbClient({ schema, dialect, events: true })
//                                                             ^? KickDbClient<SchemaToKysely<typeof schema>>
```

```ts
// after (M2 + Register, recommended)
// in src/db/register.ts (one file, three lines)
declare module '@forinda/kickjs-db' {
  interface Register {
    db: typeof dbClient
  }
}

// every consumer just uses KickDbClient — no generic, no cast
@Inject(DB_PRIMARY) private db!: KickDbClient
//                                ^? KickDbClient<SchemaToKysely<typeof schema>>
```

Repository methods drop the `as never` cast on insert values:

```ts
// before (M1)
return this.typed
  .insertInto('users')
  .values({ email: input.email /* … */ } as never)
  .returningAll()
  .executeTakeFirstOrThrow()

// after (M2)
return (
  this.db
    .insertInto('users')
    .values({ email: input.email, firstName: input.firstName, lastName: input.lastName })
    // ^ id, isActive, createdAt are Generated — typecheck passes without them
    .returningAll()
    .executeTakeFirstOrThrow()
)
```

Three-line PR. The schema is the source of truth; types follow automatically.
