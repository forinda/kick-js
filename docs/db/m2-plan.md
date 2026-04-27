# M2 — Type story + ecosystem extensibility: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the type-tightening + ecosystem-extensibility groundwork that makes
KickJS-DB feel automatic instead of permissive, and turns adapter packages into
first-class participants in DevTools / typegen / events.

**Architecture:** Three specs implement together — the M2-tightening of
`@forinda/kickjs-db`'s type story (auto-schema-typing spec), the platform-wide
plugin/event-bus/typegen substrate (platform-devtools-typegen spec), and the
DB-side query/extension API (architecture spec §6). Same `Register` augmentation
pattern threads through all of them. After M2 every adapter package follows one
convention: declare a `Register` slot, ship a `TypegenPlugin`, ship a
`defineDevtoolsTab`, publish on the event bus.

**Tech Stack:** Same as M0/M1 (TypeScript, Vitest + SWC, tsdown, wireit, Kysely,
Testcontainers PG) plus `@babel/core` + `@babel/plugin-transform-typescript` for
the Vite AST strip in M2.E.

**Specs:** [`./architecture.md`](./architecture.md) §6 (Client + extensions),
[`./spec-auto-schema-typing.md`](./spec-auto-schema-typing.md) (Layers 1-4),
[`./spec-platform-devtools-typegen.md`](./spec-platform-devtools-typegen.md)
(Subsystems A-C + AST strip).
**Stories:** [`./stories.md`](./stories.md) — M2-S1 through M2-S9 + the platform
work added by the platform spec.
**Prereq:** M1 complete (commit `0b5de4d`). All packages on `feat/db` branch up to
date with `main`.

---

## Estimated cadence

| Sub-milestone                       | Scope                                                                                                    | Days | Blockers                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| M2.A — Type story                   | Phantom generics + `SchemaToKysely` + `Register` + example migration                                     | 5    | none                                                                      |
| M2.B — Pluggable typegen            | `TypegenPlugin` contract + refactor existing generators + `kick/db` plugin                               | 6    | M2.A (the `kick/db` plugin emits what M2.A's `Register` pattern resolves) |
| M2.C — DevTools plugin contract     | `(el, props) => void` refactor + migrate first-party tabs                                                | 6    | none                                                                      |
| M2.D — Event bus                    | `KickEventBus` browser + server + typed events                                                           | 6    | none (M2.C consumes it but the bus ships independently)                   |
| M2.E — Vite AST strip               | Babel transform in `@forinda/kickjs-vite` + tests                                                        | 3    | none                                                                      |
| M2.F — DB query/extension API       | `customType<T>` + `$extends` + `db.query.X.findMany({with})` + lifecycle hooks runtime emit + slow query | 12   | M2.A (precise types feed `db.query` inference)                            |
| M2.G — Docs + 14-table example port | Guide pages + finish full port of task-prisma-api → task-kickdb-api                                      | 5    | M2.A, M2.F                                                                |

**Total: ~7 weeks** sequential, **~5 weeks** with M2.B and M2.C/D/E running in parallel.

---

## File structure

New files this plan adds:

```
packages/db/src/
  client/
    register.ts                         M2.A (T4) — Register interface
    schema-types.ts                     M2.A (T3) — rewritten
  dsl/columns/
    types.ts                            M2.A (T1) — phantom generics
    builders.ts                         M2.A (T1, T2) — declare T per builder
  query/                                M2.F — relations findMany API
    types.ts
    builder.ts
    compile.ts
  extend/                               M2.F — $extends({ model, result })
    types.ts
    apply.ts
  hooks/                                M2.F — runtime emit pipeline
    plugin.ts                           Kysely interceptor
    slow-query.ts                       slowQuery threshold detector
  custom-type.ts                        M2.F — customType<T>() mapper

packages/db/__tests__/
  unit/
    column-types.test-d.ts              M2.A (T5) — expectTypeOf
    schema-types.test-d.ts              M2.A (T5)
    register.test-d.ts                  M2.A (T5)
    custom-type.test.ts                 M2.F
    extend.test.ts                      M2.F
  integration/
    relations.test.ts                   M2.F — db.query findMany({with}) on real PG

packages/cli/src/
  typegen/
    plugin.ts                           M2.B (T7) — TypegenPlugin contract
    runner.ts                           M2.B (T8) — orchestrator
    builtin/
      routes.ts                         M2.B (T9) — refactored
      env.ts                            M2.B (T9)
      assets.ts                         M2.B (T9)
      db.ts                             M2.B (T10) — new
    check.ts                            M2.B (T11) — drift detection

packages/devtools-kit/src/             M2.C — refactored
  tab.ts                                  (el, props) => void contract
  bus/
    types.ts                            M2.D — KickEventBus + KickDevtoolsEvent
    browser.ts                          BroadcastChannel + WS client
    server.ts                           /_debug/events WS route
    registry.ts                         KickDevtoolsEventRegistry interface

packages/vite/src/
  devtools-strip.ts                     M2.E — Babel transform plugin

examples/task-kickdb-api/
  src/db/register.ts                    M2.A (T6) — example migration
  (modules/* repositories cleaned up)
```

---

## Conventions

Same as M0/M1:

- TDD where the unit can carry it; type-level tests via `expectTypeOf`.
- Conventional commits, one per task. Pre-commit runs `build → test → format:check`
  - monorepo-wide kick-lint (token prefix rules).
- All file edits use `Edit`/`Write` tools; absolute paths; pnpm from root.
- `feat/db` branch.
- New first-party DI tokens or registry keys use the reserved `kick/` prefix.

Memory rules in scope:

- New packages OK; the "only write to @forinda/kickjs" rule was about the legacy
  core/http split, not new sibling packages.
- `defineAdapter()` / `definePlugin()` factories everywhere; never class-based
  adapters.
- Tests use `Container.create()` for isolation.
- Keep BYO recipes as the ecosystem-extension story; this plan is the runtime
  scaffolding that makes those recipes drop-in.

---

# Sub-milestone M2.A — Type story (auto-schema-typing spec L1-L4)

## Task 1: Phantom `<T, TNullable>` on `ColumnBuilder`

**Story:** spec-auto-schema-typing §5 (Layer 1).
**Files:**

- Modify: `packages/db/src/dsl/columns/types.ts`
- Modify: `packages/db/src/dsl/columns/builders.ts`

- [ ] **Step 1.1: Update `ColumnBuilder` to carry phantoms**

```ts
// packages/db/src/dsl/columns/types.ts
export class ColumnBuilder<T = unknown, TNullable extends boolean = true> {
  protected state: ColumnState

  constructor(type: string, defaults: Partial<ColumnState> = {}) {
    this.state = {
      type,
      nullable: defaults.nullable ?? true,
      default: defaults.default ?? null,
      primaryKey: defaults.primaryKey ?? false,
      unique: defaults.unique ?? false,
      references: defaults.references ?? null,
    }
  }

  notNull(): ColumnBuilder<T, false> {
    this.state.nullable = false
    return this as unknown as ColumnBuilder<T, false>
  }

  default(value: string): this {
    this.state.default = value
    return this
  }

  primaryKey(): ColumnBuilder<T, false> {
    this.state.primaryKey = true
    this.state.nullable = false
    return this as unknown as ColumnBuilder<T, false>
  }

  unique(): this {
    this.state.unique = true
    return this
  }

  references(
    target: () => { __tableName: string; __name: string },
    opts: { onDelete?: string; onUpdate?: string } = {},
  ): this {
    const ref = target()
    this.state.references = {
      table: ref.__tableName,
      column: ref.__name,
      onDelete: opts.onDelete ?? 'no_action',
      onUpdate: opts.onUpdate ?? 'no_action',
    }
    return this
  }

  array(): ColumnBuilder<T[], TNullable> {
    this.state.type = `${this.state.type}[]`
    return this as unknown as ColumnBuilder<T[], TNullable>
  }

  toJSON(name: string): ColumnSnapshot {
    return {
      name,
      type: this.state.type,
      nullable: this.state.nullable,
      default: this.state.default,
      primaryKey: this.state.primaryKey,
    }
  }

  __state(): Readonly<ColumnState> {
    return this.state
  }
}
```

- [ ] **Step 1.2: Update each constructor to declare its phantom**

```ts
// packages/db/src/dsl/columns/builders.ts (cross-dialect set)
export function serial(): ColumnBuilder<number, false> {
  return new ColumnBuilder<number, false>('serial', { nullable: false })
}

export function bigSerial(): ColumnBuilder<bigint, false> {
  return new ColumnBuilder<bigint, false>('bigserial', { nullable: false })
}

export function integer(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('integer')
}

export function bigint(): ColumnBuilder<bigint> {
  return new ColumnBuilder<bigint>('bigint')
}

export function smallint(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('smallint')
}

export function decimal(precision?: number, scale?: number): ColumnBuilder<string> {
  return new ColumnBuilder<string>(formatNumeric('decimal', precision, scale))
}

export function numeric(precision?: number, scale?: number): ColumnBuilder<string> {
  return new ColumnBuilder<string>(formatNumeric('numeric', precision, scale))
}

export function real(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('real')
}

export function doublePrecision(): ColumnBuilder<number> {
  return new ColumnBuilder<number>('double precision')
}

export function varchar(length = 255): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`varchar(${length})`)
}

export function char(length = 1): ColumnBuilder<string> {
  return new ColumnBuilder<string>(`char(${length})`)
}

export function text(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('text')
}

export function boolean(): ColumnBuilder<boolean> {
  return new ColumnBuilder<boolean>('boolean')
}

export function date(): ColumnBuilder<Date> {
  return new ColumnBuilder<Date>('date')
}

export function time(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('time')
}

export function interval(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('interval')
}

export function bytea(): ColumnBuilder<Uint8Array> {
  return new ColumnBuilder<Uint8Array>('bytea')
}

export function json<T = unknown>(): ColumnBuilder<T> {
  return new ColumnBuilder<T>('json')
}

export function jsonb<T = unknown>(): ColumnBuilder<T> {
  return new ColumnBuilder<T>('jsonb')
}

// Subtype builders: extend ColumnBuilder<T> so chained methods preserve T.
export class TimestampBuilder<TNullable extends boolean = true> extends ColumnBuilder<
  Date,
  TNullable
> {
  constructor(typeName: string = 'timestamp') {
    super(typeName)
  }

  defaultNow(): this {
    this.state.default = 'CURRENT_TIMESTAMP'
    return this
  }
}

export function timestamp(): TimestampBuilder {
  return new TimestampBuilder('timestamp')
}

export function timestamptz(): TimestampBuilder {
  return new TimestampBuilder('timestamptz')
}

export class UuidBuilder<TNullable extends boolean = true> extends ColumnBuilder<
  string,
  TNullable
> {
  constructor() {
    super('uuid')
  }

  defaultRandom(): this {
    this.state.default = 'gen_random_uuid()'
    return this
  }
}

export function uuid(): UuidBuilder {
  return new UuidBuilder()
}
```

- [ ] **Step 1.3: Update PG-only subpath builders**

```ts
// packages/db/src/dsl/columns/pg.ts — declare strings for the niche types
export function tsvector(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('tsvector')
}
export function vector(dim?: number): ColumnBuilder<number[]> {
  return new ColumnBuilder<number[]>(dim === undefined ? 'vector' : `vector(${dim})`)
}
export function citext(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('citext')
}
export function money(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('money')
}
export function inet(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('inet')
}
export function cidr(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('cidr')
}
export function xml(): ColumnBuilder<string> {
  return new ColumnBuilder<string>('xml')
}
```

- [ ] **Step 1.4: Run existing tests — must stay green**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: all 152 tests still pass. Phantoms are type-only; runtime is unchanged.

- [ ] **Step 1.5: Commit**

```bash
git add packages/db/src/dsl/columns
git commit -m "feat(db): add phantom <T, TNullable> generics to ColumnBuilder (M2.A-T1)"
```

---

## Task 2: `__isGenerated` marker for serial / bigSerial / smallSerial

**Story:** spec-auto-schema-typing §5 + §6 (`Generated<T>` wrapping).
**Files:**

- Modify: `packages/db/src/dsl/columns/types.ts`
- Modify: `packages/db/src/dsl/columns/builders.ts`

The marker is a type-level brand that runtime ignores. Uses an unused symbol so it
can never collide with user data.

- [ ] **Step 2.1: Add the brand and mark serial constructors**

```ts
// packages/db/src/dsl/columns/types.ts (export the brand)
export const KICK_GENERATED = Symbol.for('@forinda/kickjs-db/Generated')
export type GeneratedBrand = { readonly [KICK_GENERATED]: true }
```

```ts
// packages/db/src/dsl/columns/builders.ts (excerpt — append helpers)
import { ColumnBuilder, type GeneratedBrand } from './types'

// Helper — runtime is identity, type-level adds the brand.
function brandGenerated<C>(col: C): C & GeneratedBrand {
  return col as C & GeneratedBrand
}

export function serial(): ColumnBuilder<number, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<number, false>('serial', { nullable: false }))
}

export function bigSerial(): ColumnBuilder<bigint, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<bigint, false>('bigserial', { nullable: false }))
}

export function smallSerial(): ColumnBuilder<number, false> & GeneratedBrand {
  return brandGenerated(new ColumnBuilder<number, false>('smallserial', { nullable: false }))
}
```

- [ ] **Step 2.2: Mark `uuid().defaultRandom()` as generated**

```ts
// packages/db/src/dsl/columns/builders.ts (UuidBuilder)
export class UuidBuilder<TNullable extends boolean = true> extends ColumnBuilder<
  string,
  TNullable
> {
  constructor() {
    super('uuid')
  }

  defaultRandom(): this & GeneratedBrand {
    this.state.default = 'gen_random_uuid()'
    return this as this & GeneratedBrand
  }
}
```

- [ ] **Step 2.3: Mark `timestamp().defaultNow()` / `timestamptz().defaultNow()` as generated**

```ts
// TimestampBuilder
defaultNow(): this & GeneratedBrand {
  this.state.default = 'CURRENT_TIMESTAMP'
  return this as this & GeneratedBrand
}
```

- [ ] **Step 2.4: Mark `.default(...)` as generated when given a runtime default**

```ts
// ColumnBuilder
default(value: string): this & GeneratedBrand {
  this.state.default = value
  return this as this & GeneratedBrand
}
```

> **Note**: a column with `.default('0')` is "DB-defaulted" — caller can omit on
> insert. So it should be treated as `Generated<T>` by `SchemaToKysely`. This is
> the cleanest way to express "this column has a runtime default that the DB will
> fill in if you skip it."

- [ ] **Step 2.5: Run + commit**

```bash
pnpm --filter @forinda/kickjs-db test
git commit -m "feat(db): mark generated columns (serial, default, defaultNow, defaultRandom) (M2.A-T2)"
```

---

## Task 3: Tighten `SchemaToKysely<S>` (Layer 2)

**Story:** spec-auto-schema-typing §6.
**Files:**

- Modify: `packages/db/src/client/schema-types.ts`

- [ ] **Step 3.1: Rewrite `SchemaToKysely`**

```ts
// packages/db/src/client/schema-types.ts
import type { Generated } from 'kysely'
import type { ColumnBuilder, GeneratedBrand } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * Pull T (cell type) and Nullable from a column. If the column carries the
 * GeneratedBrand (set by serial / bigSerial / .default(…) / .defaultNow() /
 * .defaultRandom()), wrap T in Kysely's Generated<T> so adopters can omit
 * the column on insert.
 */
type ColumnTSType<C> = C extends GeneratedBrand
  ? C extends ColumnBuilder<infer T, infer Nullable>
    ? Nullable extends true
      ? Generated<T> | null
      : Generated<T>
    : never
  : C extends ColumnBuilder<infer T, infer Nullable>
    ? Nullable extends true
      ? T | null
      : T
    : never

export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C> ? { [Col in keyof C]: ColumnTSType<C[Col]> } : never
}
```

- [ ] **Step 3.2: Verify the existing `examples/task-kickdb-api` schema infers correctly**

```ts
// scratch test (won't commit) — packages/db/__tests__/unit/schema-infer-scratch.test-d.ts
import { expectTypeOf } from 'vitest'
import type { Generated } from 'kysely'
import type { SchemaToKysely } from '@forinda/kickjs-db'
import * as schema from '../../../examples/task-kickdb-api/src/db/schema'

type DB = SchemaToKysely<typeof schema>
expectTypeOf<DB['users']['id']>().toEqualTypeOf<Generated<string>>()
expectTypeOf<DB['users']['email']>().toEqualTypeOf<string>()
expectTypeOf<DB['users']['avatarUrl']>().toEqualTypeOf<string | null>()
expectTypeOf<DB['users']['isActive']>().toEqualTypeOf<Generated<boolean>>() // .default('true')
expectTypeOf<DB['users']['createdAt']>().toEqualTypeOf<Generated<Date>>() // .defaultNow()
```

- [ ] **Step 3.3: Run + commit**

```bash
pnpm --filter @forinda/kickjs-db test  # type-tests run via vitest typecheck mode
rm packages/db/__tests__/unit/schema-infer-scratch.test-d.ts  # was scratch
git commit -m "feat(db): tighten SchemaToKysely with phantom inference + Generated wrapping (M2.A-T3)"
```

---

## Task 4: `Register` interface augmentation (Layer 3)

**Story:** spec-auto-schema-typing §7.
**Files:**

- Create: `packages/db/src/client/register.ts`
- Modify: `packages/db/src/client/types.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 4.1: Create the empty `Register` interface**

```ts
// packages/db/src/client/register.ts
/**
 * Module-augmentable registry. Adopters declare:
 *
 *   declare module '@forinda/kickjs-db' {
 *     interface Register {
 *       db: typeof appDb
 *     }
 *   }
 *
 * KickDbClient resolves its DB generic from Register['db'] when no explicit
 * type is supplied. `kick db typegen` (M2.B-T10) writes this declaration
 * for adopters who opt into the codegen path.
 */
export interface Register {}

export type RegisteredDb = Register extends { db: infer D } ? D : never
```

- [ ] **Step 4.2: Wire `KickDbClient` to resolve through `Register`**

```ts
// packages/db/src/client/types.ts (excerpt — replace existing KickDbClient default)
import type { RegisteredDb } from './register'

type ResolveDb<DB> = unknown extends DB
  ? RegisteredDb extends KickDbClient<infer X>
    ? X
    : unknown
  : DB

export interface KickDbClient<DB = ResolveDb<unknown>> {
  // …existing surface unchanged
}
```

> **Tradeoff**: this lazy fallback resolves at the consumer site. When adopters
> haven't declared `Register`, `KickDbClient` falls back to the M1-permissive
> `unknown`. No regression.

- [ ] **Step 4.3: Re-export from barrel**

```ts
// packages/db/src/index.ts (append)
export type { Register, RegisteredDb } from './client/register'
```

- [ ] **Step 4.4: Run + commit**

```bash
pnpm --filter @forinda/kickjs-db test
git commit -m "feat(db): Register interface augmentation for automatic KickDbClient typing (M2.A-T4)"
```

---

## Task 5: Type-level test suite via `expectTypeOf`

**Story:** spec-auto-schema-typing §9 (testing strategy).
**Files:**

- Create: `packages/db/__tests__/unit/column-types.test-d.ts`
- Create: `packages/db/__tests__/unit/schema-types.test-d.ts`
- Create: `packages/db/__tests__/unit/register.test-d.ts`

- [ ] **Step 5.1: Column phantom inference tests**

```ts
// packages/db/__tests__/unit/column-types.test-d.ts
import { describe, it, expectTypeOf } from 'vitest'
import {
  serial,
  integer,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  uuid,
  json,
  jsonb,
  ColumnBuilder,
} from '@forinda/kickjs-db'

describe('column phantom T inference', () => {
  it('serial → ColumnBuilder<number, false>', () => {
    expectTypeOf(serial()).toMatchTypeOf<ColumnBuilder<number, false>>()
  })
  it('integer() is nullable by default', () => {
    expectTypeOf(integer()).toMatchTypeOf<ColumnBuilder<number, true>>()
  })
  it('integer().notNull() narrows TNullable to false', () => {
    expectTypeOf(integer().notNull()).toMatchTypeOf<ColumnBuilder<number, false>>()
  })
  it('varchar(255).primaryKey() narrows TNullable to false', () => {
    expectTypeOf(varchar(255).primaryKey()).toMatchTypeOf<ColumnBuilder<string, false>>()
  })
  it('jsonb<{ tags: string[] }>() carries the user type', () => {
    expectTypeOf(jsonb<{ tags: string[] }>()).toMatchTypeOf<
      ColumnBuilder<{ tags: string[] }, true>
    >()
  })
  it('integer().array() → ColumnBuilder<number[], TNullable>', () => {
    expectTypeOf(integer().array()).toMatchTypeOf<ColumnBuilder<number[], true>>()
  })
})
```

- [ ] **Step 5.2: `SchemaToKysely` end-to-end tests**

```ts
// packages/db/__tests__/unit/schema-types.test-d.ts
import { describe, expectTypeOf, it } from 'vitest'
import type { Generated } from 'kysely'
import {
  table,
  serial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uuid,
  type SchemaToKysely,
} from '@forinda/kickjs-db'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: varchar(120),
  isActive: boolean().notNull().default('true'),
  createdAt: timestamp().notNull().defaultNow(),
  signupCount: integer(),
  bio: text(),
})

const posts = table('posts', {
  id: uuid().primaryKey().defaultRandom(),
  authorId: integer().notNull(),
  body: text().notNull(),
})

type DB = SchemaToKysely<{ users: typeof users; posts: typeof posts }>

describe('SchemaToKysely', () => {
  it('generated columns wrap in Generated<T>', () => {
    expectTypeOf<DB['users']['id']>().toEqualTypeOf<Generated<number>>()
    expectTypeOf<DB['users']['createdAt']>().toEqualTypeOf<Generated<Date>>()
    expectTypeOf<DB['users']['isActive']>().toEqualTypeOf<Generated<boolean>>()
    expectTypeOf<DB['posts']['id']>().toEqualTypeOf<Generated<string>>()
  })

  it('not-null columns are bare T', () => {
    expectTypeOf<DB['users']['email']>().toEqualTypeOf<string>()
    expectTypeOf<DB['posts']['authorId']>().toEqualTypeOf<number>()
    expectTypeOf<DB['posts']['body']>().toEqualTypeOf<string>()
  })

  it('nullable columns are T | null', () => {
    expectTypeOf<DB['users']['name']>().toEqualTypeOf<string | null>()
    expectTypeOf<DB['users']['signupCount']>().toEqualTypeOf<number | null>()
    expectTypeOf<DB['users']['bio']>().toEqualTypeOf<string | null>()
  })
})
```

- [ ] **Step 5.3: `Register`-driven `KickDbClient` widening test**

```ts
// packages/db/__tests__/unit/register.test-d.ts
import { describe, expectTypeOf, it } from 'vitest'
import type { Generated } from 'kysely'
import type { KickDbClient, SchemaToKysely } from '@forinda/kickjs-db'
import { table, serial, varchar } from '@forinda/kickjs-db'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
})

declare module '@forinda/kickjs-db' {
  interface Register {
    db: KickDbClient<SchemaToKysely<{ users: typeof users }>>
  }
}

describe('Register-driven typing', () => {
  it('KickDbClient with no generic resolves through Register', () => {
    declare const db: KickDbClient
    expectTypeOf(db.selectFrom('users').selectAll().execute()).resolves.toEqualTypeOf<
      Array<{ id: Generated<number>; email: string }>
    >()
  })
})
```

- [ ] **Step 5.4: Wire vitest typecheck mode**

Verify `packages/db/vitest.config.ts` has `test.typecheck.tsconfig` pointing at
`tsconfig.test.json` (already true from M0). Test files ending in `.test-d.ts`
are picked up by vitest typecheck mode.

```bash
pnpm --filter @forinda/kickjs-db test --typecheck
```

Expected: type tests pass; existing runtime tests unaffected.

- [ ] **Step 5.5: Commit**

```bash
git add packages/db/__tests__/unit/{column-types,schema-types,register}.test-d.ts
git commit -m "test(db): expectTypeOf coverage for phantom inference + SchemaToKysely + Register (M2.A-T5)"
```

---

## Task 6: Migrate `examples/task-kickdb-api`

**Story:** spec-auto-schema-typing §11 + Appendix A.
**Files:**

- Create: `examples/task-kickdb-api/src/db/register.ts`
- Modify: `examples/task-kickdb-api/src/db/client.ts`
- Modify: `examples/task-kickdb-api/src/modules/{users,workspaces,tasks}/*.repository.ts`

- [ ] **Step 6.1: Drop the manual `interface DB` from client.ts**

```ts
// examples/task-kickdb-api/src/db/client.ts (M2 — replace whole file)
import { Pool } from 'pg'
import { PostgresDialect } from 'kysely'
import { createDbClient, type KickDbClient } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
export const pool = new Pool({ connectionString })

// No explicit DB generic — SchemaToKysely<typeof schema> is inferred.
export const dbClient = createDbClient({
  schema,
  dialect: new PostgresDialect({ pool }),
  events: true,
})

export const migrationAdapter = pgAdapter({ pool })

export type Db = typeof dbClient
export { schema }
```

- [ ] **Step 6.2: Create the `Register` augmentation file**

```ts
// examples/task-kickdb-api/src/db/register.ts
import type { dbClient } from './client'

declare module '@forinda/kickjs-db' {
  interface Register {
    db: typeof dbClient
  }
}
```

Make sure `register.ts` is referenced from `src/index.ts` as a side-effect
import (so TS picks up the augmentation):

```ts
// src/index.ts (add right after the env import)
import './db/register'
```

- [ ] **Step 6.3: Strip `as never` casts from repositories**

```ts
// examples/task-kickdb-api/src/modules/users/users.repository.ts (excerpt)
@Service()
export class UsersRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  async list() {
    return this.db.selectFrom('users').selectAll().orderBy('createdAt', 'asc').execute()
  }

  async findById(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }

  async findByEmail(email: string) {
    return this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }

  async create(input: NewUser) {
    return this.db
      .insertInto('users')
      .values({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        avatarUrl: input.avatarUrl ?? null,
        // id, isActive, createdAt are Generated — typechecks without them
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
```

Same shape for `workspaces.repository.ts` and `tasks.repository.ts`. The
`as never` cast and the private `typed` getter both go away.

- [ ] **Step 6.4: Verify**

```bash
pnpm --filter @forinda/kickjs-example-task-kickdb typecheck
pnpm --filter @forinda/kickjs-example-task-kickdb build
```

Expected: clean. Returned row types in IDE narrow correctly to the schema.

- [ ] **Step 6.5: Commit**

```bash
git commit -m "example(task-kickdb-api): drop manual interface DB; use Register augmentation (M2.A-T6)"
```

---

# Sub-milestone M2.B — Pluggable typegen (platform spec §6)

## Task 7: `TypegenPlugin` contract + runner

**Story:** spec-platform-devtools-typegen §6.3.
**Files:**

- Create: `packages/cli/src/typegen/plugin.ts`
- Create: `packages/cli/src/typegen/runner.ts`
- Create: `packages/cli/src/typegen/builtin/index.ts`

- [ ] **Step 7.1: Define the contract**

```ts
// packages/cli/src/typegen/plugin.ts
import type { KickConfig } from '../config'

export interface TypegenContext {
  cwd: string
  config: KickConfig
  importTs<T = unknown>(absPath: string): Promise<T>
  writeFile(relPath: string, contents: string): Promise<void>
  log: TypegenLogger
}

export interface TypegenLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface TypegenPlugin {
  /** Stable id — used as filename: `.kickjs/types/${id}.d.ts` */
  id: string
  /** Glob patterns this plugin watches; Vite plugin re-runs on change. */
  inputs: string[]
  /**
   * Return the augmentation source (without the auto-generated banner — that
   * gets prepended). Return null to skip emission (e.g. no schema file).
   */
  generate(ctx: TypegenContext): Promise<string | null>
}

export interface TypegenPluginResult {
  id: string
  status: 'written' | 'unchanged' | 'skipped'
  outFile?: string
}
```

- [ ] **Step 7.2: Runner**

```ts
// packages/cli/src/typegen/runner.ts
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import type { KickConfig } from '../config'
import type { TypegenPlugin, TypegenContext, TypegenPluginResult } from './plugin'

const TYPES_DIR = '.kickjs/types'
const BANNER = '/* AUTO-GENERATED by kick typegen — do not edit. Plugin: '

export interface RunTypegenOptions {
  cwd: string
  config: KickConfig
  plugins: TypegenPlugin[]
  /** When true, fail if any plugin would have changed output. CI drift detection. */
  check?: boolean
}

export async function runTypegen(opts: RunTypegenOptions): Promise<TypegenPluginResult[]> {
  const typesDirAbs = path.resolve(opts.cwd, TYPES_DIR)
  await mkdir(typesDirAbs, { recursive: true })

  const ctx: TypegenContext = {
    cwd: opts.cwd,
    config: opts.config,
    async importTs(abs) {
      return (await import(pathToFileURL(abs).href)) as never
    },
    async writeFile(relPath, contents) {
      await mkdir(path.dirname(path.resolve(opts.cwd, relPath)), { recursive: true })
      await writeFile(path.resolve(opts.cwd, relPath), contents, 'utf8')
    },
    log: console,
  }

  const results: TypegenPluginResult[] = []
  for (const plugin of opts.plugins) {
    const out = await plugin.generate(ctx)
    if (out === null) {
      results.push({ id: plugin.id, status: 'skipped' })
      continue
    }
    const file = path.join(typesDirAbs, `${plugin.id.replace(/\//g, '__')}.d.ts`)
    const banner = `${BANNER}${plugin.id} */\n\n`
    const next = banner + out + '\n'

    let prev = ''
    if (existsSync(file)) prev = await readFile(file, 'utf8')

    if (prev === next) {
      results.push({ id: plugin.id, status: 'unchanged', outFile: file })
      continue
    }

    if (opts.check) {
      throw new Error(`kick typegen --check: drift detected for ${plugin.id} (${file})`)
    }
    await writeFile(file, next, 'utf8')
    results.push({ id: plugin.id, status: 'written', outFile: file })
  }

  return results
}
```

- [ ] **Step 7.3: Smoke test the runner against a tiny inline plugin**

```ts
// packages/cli/__tests__/typegen-runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runTypegen, type TypegenPlugin } from '../src/typegen/plugin'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-typegen-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const plugin: TypegenPlugin = {
  id: 'test/echo',
  inputs: [],
  async generate() {
    return 'export type Echo = "hello"'
  },
}

describe('runTypegen', () => {
  it('writes the file with banner', async () => {
    const r = await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    expect(r[0].status).toBe('written')
    const out = await readFile(r[0].outFile!, 'utf8')
    expect(out).toContain('AUTO-GENERATED')
    expect(out).toContain('Echo = "hello"')
  })

  it('marks unchanged on second run', async () => {
    await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    const r2 = await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    expect(r2[0].status).toBe('unchanged')
  })

  it('--check throws on drift', async () => {
    await runTypegen({ cwd: dir, config: {} as never, plugins: [plugin] })
    const drifted: TypegenPlugin = {
      ...plugin,
      async generate() {
        return 'export type Echo = "drift"'
      },
    }
    await expect(
      runTypegen({ cwd: dir, config: {} as never, plugins: [drifted], check: true }),
    ).rejects.toThrow(/drift detected/)
  })
})
```

- [ ] **Step 7.4: Commit**

```bash
git add packages/cli/src/typegen packages/cli/__tests__/typegen-runner.test.ts
git commit -m "feat(cli): TypegenPlugin contract + runner with --check (M2.B-T7)"
```

---

## Task 8: Refactor existing generators to plugins

**Story:** spec-platform-devtools-typegen §6.4.
**Files:**

- Modify: `packages/cli/src/typegen/` — split current monolithic typegen into:
  - `builtin/routes.ts` — emits `.kickjs/types/kick__routes.d.ts`
  - `builtin/env.ts` — emits `.kickjs/types/kick__env.d.ts`
  - `builtin/assets.ts` — emits `.kickjs/types/kick__assets.d.ts`

- [ ] **Step 8.1: Read existing typegen implementation, extract pure logic**

```bash
ls packages/cli/src/typegen/
cat packages/cli/src/typegen/index.ts | head -60
```

> **Adapter note**: I have not pre-read the existing `kick typegen`
> implementation. The actual file structure may differ from what's shown
> above; before writing code, read the current files and adapt the refactor
> to fit. The key invariant: each existing generator produces one file in
> `.kickjs/types/`; carve that into a `TypegenPlugin` and route through
> the runner from T7.

- [ ] **Step 8.2: Implement each builtin plugin as a thin wrapper**

```ts
// packages/cli/src/typegen/builtin/routes.ts
import { generateRoutesAugmentation } from '../legacy/routes-impl' // existing function moved
import type { TypegenPlugin } from '../plugin'

export const kickRoutesTypegen = (): TypegenPlugin => ({
  id: 'kick/routes',
  inputs: ['src/modules/**/*.controller.{ts,tsx}'],
  async generate(ctx) {
    return generateRoutesAugmentation(ctx)
  },
})
```

(Same shape for `env.ts` and `assets.ts` — wrap existing generation logic.)

- [ ] **Step 8.3: Update `kick typegen` CLI command to use the runner**

```ts
// packages/cli/src/commands/typegen.ts (sketch)
import { runTypegen } from '../typegen/runner'
import { kickRoutesTypegen, kickEnvTypegen, kickAssetsTypegen } from '../typegen/builtin'

export function registerTypegenCommand(program: Command) {
  program
    .command('typegen')
    .option('--check', 'Fail on drift instead of writing')
    .action(async (opts) => {
      const config = await loadKickConfig(process.cwd())
      const builtins = [kickRoutesTypegen(), kickEnvTypegen(), kickAssetsTypegen()]
      const userPlugins = config.typegen?.plugins ?? []
      const plugins = [...builtins, ...userPlugins]
      const results = await runTypegen({
        cwd: process.cwd(),
        config,
        plugins,
        check: opts.check,
      })
      for (const r of results) console.log(`  ${r.id}: ${r.status}`)
    })
}
```

- [ ] **Step 8.4: Smoke-test against an existing example**

```bash
cd examples/db-spike-api  # has minimal config; routes/env/assets all empty-ish
node ../../packages/cli/bin.js typegen
ls .kickjs/types/
```

Expected: `kick__routes.d.ts`, `kick__env.d.ts`, `kick__assets.d.ts` exist with
the expected augmentations.

- [ ] **Step 8.5: Commit**

```bash
git commit -m "refactor(cli): existing typegen becomes builtin TypegenPlugins (M2.B-T8)"
```

---

## Task 9: `kick/db` typegen plugin

**Story:** spec-auto-schema-typing §8 + spec-platform-devtools-typegen §6.4.
**Files:**

- Create: `packages/cli/src/typegen/builtin/db.ts`
- Modify: `packages/cli/src/commands/typegen.ts` (register the new builtin)

- [ ] **Step 9.1: Plugin implementation**

```ts
// packages/cli/src/typegen/builtin/db.ts
import path from 'node:path'
import { existsSync } from 'node:fs'
import type { TypegenPlugin } from '../plugin'

export const kickDbTypegen = (): TypegenPlugin => ({
  id: 'kick/db',
  inputs: ['src/db/schema.ts', 'src/db/schema/**/*.ts'],
  async generate(ctx) {
    const schemaPath = ctx.config.db?.schemaPath ?? 'src/db/schema.ts'
    const abs = path.resolve(ctx.cwd, schemaPath)
    if (!existsSync(abs)) return null

    // Two-part augmentation:
    //   1. global KickDbSchema interface populated by SchemaToKysely<typeof appSchema>
    //   2. Register augmentation pointing the package's Register['db'] at it
    //
    // We don't compute SchemaToKysely<...> manually — TS does, given the import.
    const rel = posixOf(
      path.relative(path.resolve(ctx.cwd, '.kickjs/types'), abs).replace(/\.ts$/, ''),
    )
    return [
      `import type { SchemaToKysely, KickDbClient } from '@forinda/kickjs-db'`,
      `import type * as appSchema from '${rel}'`,
      ``,
      `declare global {`,
      `  interface KickDbSchema extends SchemaToKysely<typeof appSchema> {}`,
      `}`,
      ``,
      `declare module '@forinda/kickjs-db' {`,
      `  interface Register {`,
      `    db: KickDbClient<KickDbSchema>`,
      `  }`,
      `}`,
    ].join('\n')
  },
})

function posixOf(p: string): string {
  return p.replace(/\\/g, '/')
}
```

> The plugin emits **TS source that imports the schema and computes
> `SchemaToKysely<typeof appSchema>` at type-check time** — no runtime cost,
> no need to materialise the type to a literal. The adopter project's
> `tsconfig.json` already includes `.kickjs/types/**/*.d.ts`, so the
> generated file augments `KickDbClient` automatically.

- [ ] **Step 9.2: Register the builtin**

```ts
// packages/cli/src/commands/typegen.ts (add)
import { kickDbTypegen } from '../typegen/builtin/db'
const builtins = [kickRoutesTypegen(), kickEnvTypegen(), kickAssetsTypegen(), kickDbTypegen()]
```

- [ ] **Step 9.3: Smoke-test against `examples/task-kickdb-api`**

```bash
cd examples/task-kickdb-api
node ../../packages/cli/bin.js typegen
cat .kickjs/types/kick__db.d.ts
```

Expected: file exists, references the schema via relative import path,
contains the `Register` augmentation. After running typegen, the adopter
can **delete** their hand-written `src/db/register.ts` from M2-T6.

- [ ] **Step 9.4: Commit**

```bash
git commit -m "feat(cli): kick/db TypegenPlugin emits Register augmentation from src/db/schema.ts (M2.B-T9)"
```

---

## Task 10: Vite watcher integration

**Story:** spec-platform-devtools-typegen §6.6.
**Files:**

- Modify: `packages/vite/src/index.ts` — extend the existing typegen watcher to
  read the resolved plugin list, watch each plugin's globs, re-run the runner on
  change.

- [ ] **Step 10.1: Read existing watcher**

```bash
grep -n "typegen\|chokidar" packages/vite/src/*.ts | head
```

Adapt the integration to fit the existing shape. The runner from T7 is the
target; the existing watcher just dispatches to it now.

- [ ] **Step 10.2: Implement single watcher → multi-plugin dispatch**

```ts
// packages/vite/src/typegen-watcher.ts (new)
import chokidar from 'chokidar'
import { runTypegen, type TypegenPlugin } from '@forinda/kickjs-cli/typegen'
import type { KickConfig } from '@forinda/kickjs-cli'

export function startTypegenWatcher(opts: {
  cwd: string
  config: KickConfig
  plugins: TypegenPlugin[]
}) {
  const inputs = Array.from(new Set(opts.plugins.flatMap((p) => p.inputs)))
  const watcher = chokidar.watch(inputs, { cwd: opts.cwd, ignoreInitial: true })
  watcher.on('all', async () => {
    await runTypegen({ ...opts })
  })
  return () => watcher.close()
}
```

- [ ] **Step 10.3: Commit**

```bash
git commit -m "feat(vite): typegen watcher dispatches through TypegenPlugin runner (M2.B-T10)"
```

---

## Task 11: `kick typegen --check` in CI

**Story:** spec-platform-devtools-typegen §6.7.

- [ ] **Step 11.1: Add `kick typegen --check` to CI workflow**

```yaml
# .github/workflows/ci.yml — add a step after install
- name: typegen drift check
  run: pnpm exec kick typegen --check
```

- [ ] **Step 11.2: Smoke-test locally that drift is detected**

```bash
# pretend: edit src/db/schema.ts in the example, don't re-run typegen
# kick typegen --check
# expected: exits non-zero, references kick/db plugin
```

- [ ] **Step 11.3: Commit**

```bash
git commit -m "ci: kick typegen --check guards against generator drift (M2.B-T11)"
```

---

# Sub-milestone M2.C — DevTools plugin contract refactor

## Task 12: Refactor `defineDevtoolsTab` to `(el, props) => void`

**Story:** spec-platform-devtools-typegen §4.

> **Adapter note**: `@forinda/kickjs-devtools-kit` source is not pre-read here.
> The first step is to read what's there, then design the migration.

- [ ] **Step 12.1: Read existing surface**

```bash
ls packages/devtools-kit/src/
cat packages/devtools-kit/src/index.ts
```

- [ ] **Step 12.2: Add the new `DevtoolsTab` shape alongside existing**

```ts
// packages/devtools-kit/src/tab.ts (new file — coexists with old)
import type { KickEventBus } from './bus/types' // M2.D supplies this; until then,
// export an `unknown` placeholder.

export interface TabRuntimeConfig {
  theme: 'dark' | 'light'
  panelHeight: number
}

export interface TabProps {
  bus: KickEventBus
  config: TabRuntimeConfig
  query: URLSearchParams
}

export interface DevtoolsTab<TProps = TabProps> {
  id: string
  name: string | ((el: HTMLElement) => void)
  badge?: () => string | number | null
  render: (el: HTMLElement, props: TProps) => void | (() => void)
  defaultOpen?: boolean
}

export function defineDevtoolsTab<TProps = TabProps>(
  spec: DevtoolsTab<TProps>,
): DevtoolsTab<TProps> {
  return spec
}
```

- [ ] **Step 12.3: Migrate first-party tabs**

For each adapter that ships a tab (`@forinda/kickjs-db`, `swagger`, `queue`, `cron`,
`devtools-kit` itself), rewrite the tab module to use the new contract. Use safe
DOM construction — never `innerHTML` with non-static strings — to keep the
plugin safe against XSS even when adopter-side state lands in the panel:

```ts
// example: packages/db/src/devtools/tab.ts
import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'

export const dbDevtoolsTab = defineDevtoolsTab({
  id: 'kick/db',
  name: 'Database',
  render(el, props) {
    const root = document.createElement('div')
    root.className = 'kickdb-tab'

    const header = document.createElement('h2')
    header.textContent = 'Database'
    root.appendChild(header)

    const log = document.createElement('ul')
    log.className = 'kickdb-slow-query-log'
    root.appendChild(log)

    el.replaceChildren(root)

    const off = props.bus.on('db:slow-query', (e) => {
      const row = document.createElement('li')
      // textContent on user-supplied SQL strings — no HTML interpolation
      row.textContent = `${e.payload.durationMs}ms — ${e.payload.sql}`
      log.appendChild(row)
    })

    return () => {
      off()
      el.replaceChildren()
    }
  },
})
```

> **Why this matters:** the panel can receive payloads from anywhere on the
> bus (server, other tabs). Plugin authors who reach for `innerHTML` open
> themselves to XSS the moment a payload contains attacker-controlled text.
> The DOM-construction style above is the canonical pattern; document it in
> the migration guide.

- [ ] **Step 12.4: Mark the old class-based contract deprecated**

```ts
// packages/devtools-kit/src/legacy.ts (rename old surface)
/** @deprecated since v6.0 — migrate to defineDevtoolsTab() with the (el, props) => void contract. */
export interface LegacyDevtoolsTab {
  /* … */
}
```

- [ ] **Step 12.5: Commit**

```bash
git commit -m "feat(devtools): defineDevtoolsTab → (el, props) => void contract (M2.C-T12)"
```

---

# Sub-milestone M2.D — Multi-tier event bus

## Task 13: `KickEventBus` interface + browser implementation

**Story:** spec-platform-devtools-typegen §5.

- [ ] **Step 13.1: Types**

```ts
// packages/devtools-kit/src/bus/types.ts
export interface KickDevtoolsEvent<T = unknown> {
  type: string
  payload: T
  pluginId?: string
  ts: number
}

export interface KickEventBus {
  emit<T>(event: KickDevtoolsEvent<T>): void
  on<T>(type: string, handler: (e: KickDevtoolsEvent<T>) => void): () => void
  /** Wildcard subscriber — sees every event; for the activity-log tab. */
  onAny(handler: (e: KickDevtoolsEvent) => void): () => void
}

/** Adopter packages augment to type-tag emit/on. */
export interface KickDevtoolsEventRegistry {}

export type EventTypeKey = keyof KickDevtoolsEventRegistry & string
export type EventPayload<K extends EventTypeKey> = KickDevtoolsEventRegistry[K]
```

- [ ] **Step 13.2: Browser impl**

```ts
// packages/devtools-kit/src/bus/browser.ts
import type { KickDevtoolsEvent, KickEventBus } from './types'

export function createBrowserBus(
  opts: {
    channel?: string
    wsUrl?: string
  } = {},
): KickEventBus {
  const channelName = opts.channel ?? 'kick-devtools'
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null
  const handlers = new Map<string, Set<(e: KickDevtoolsEvent) => void>>()
  const anyHandlers = new Set<(e: KickDevtoolsEvent) => void>()

  let socket: WebSocket | null = null
  function ensureSocket() {
    if (!opts.wsUrl) return
    if (socket && socket.readyState !== WebSocket.CLOSED) return
    socket = new WebSocket(opts.wsUrl)
    socket.onmessage = (msg) => deliver(JSON.parse(msg.data) as KickDevtoolsEvent)
  }

  function deliver(e: KickDevtoolsEvent) {
    handlers.get(e.type)?.forEach((h) => h(e))
    anyHandlers.forEach((h) => h(e))
  }

  channel?.addEventListener('message', (msg) => deliver(msg.data as KickDevtoolsEvent))

  return {
    emit(event) {
      channel?.postMessage(event)
      ensureSocket()
      socket?.send(JSON.stringify(event))
      deliver(event) // local in-process subscribers
    },
    on(type, handler) {
      ensureSocket()
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler as never)
      return () => {
        set!.delete(handler as never)
      }
    },
    onAny(handler) {
      ensureSocket()
      anyHandlers.add(handler)
      return () => {
        anyHandlers.delete(handler)
      }
    },
  }
}
```

- [ ] **Step 13.3: Server impl + Express WS route**

```ts
// packages/devtools-kit/src/bus/server.ts
import { EventEmitter } from 'node:events'
import type { Express } from 'express'
import { WebSocketServer } from 'ws'
import type { KickDevtoolsEvent, KickEventBus } from './types'

export function createServerBus(opts: { app: Express; path?: string }): KickEventBus {
  const emitter = new EventEmitter()
  const wss = new WebSocketServer({ noServer: true })
  const path = opts.path ?? '/_debug/events'

  // Wire to the express server's HTTP upgrade.
  // (kickjs Application exposes the underlying http.Server; adapter wires it
  //  via the afterStart hook — the WS upgrade lives in @forinda/kickjs-devtools.)

  wss.on('connection', (ws) => {
    const fwd = (e: KickDevtoolsEvent) => ws.send(JSON.stringify(e))
    emitter.on('event', fwd)
    ws.on('close', () => emitter.off('event', fwd))
  })

  const handlers = new Map<string, Set<(e: KickDevtoolsEvent) => void>>()
  const any = new Set<(e: KickDevtoolsEvent) => void>()

  return {
    emit(event) {
      emitter.emit('event', event) // out to WS clients
      handlers.get(event.type)?.forEach((h) => h(event))
      any.forEach((h) => h(event))
    },
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler as never)
      return () => {
        set!.delete(handler as never)
      }
    },
    onAny(handler) {
      any.add(handler)
      return () => {
        any.delete(handler)
      }
    },
  }
}
```

- [ ] **Step 13.4: Tests**

Unit-test handler/onAny wiring against a stub channel/socket. Cross-tab is harder
to test in vitest; integration deferred to M3.

- [ ] **Step 13.5: Commit**

```bash
git commit -m "feat(devtools): KickEventBus with BroadcastChannel + WS transports (M2.D-T13)"
```

---

## Task 14: Wire first-party adapters to publish

**Story:** spec-platform-devtools-typegen §5.4.

- [ ] **Step 14.1: kickjs-db emits `db:slow-query` + `db:migration-applied`**

```ts
// packages/db/src/adapter.ts (within beforeStart, when migrationsOnBoot:'apply' fires)
import type { KickEventBus } from '@forinda/kickjs-devtools-kit'

// optional config.bus?: KickEventBus

// after migrateLatest():
config.bus?.emit({
  type: 'db:migration-applied',
  payload: { applied: r.applied, batch: r.batch },
  pluginId: 'kick/db',
  ts: Date.now(),
})
```

- [ ] **Step 14.2: Type-tag the events via `KickDevtoolsEventRegistry`**

```ts
// packages/db/src/adapter.ts (top of file)
declare module '@forinda/kickjs-devtools-kit' {
  interface KickDevtoolsEventRegistry {
    'db:slow-query': { sql: string; parameters: unknown[]; durationMs: number }
    'db:migration-applied': { applied: string[]; batch: number | null }
    'db:pending-migrations': { count: number; ids: string[] }
  }
}
```

- [ ] **Step 14.3: Commit**

```bash
git commit -m "feat(db): publish db:slow-query / db:migration-applied via KickEventBus (M2.D-T14)"
```

---

# Sub-milestone M2.E — Vite AST strip

## Task 15: Babel transform plugin

**Story:** spec-platform-devtools-typegen §7.

- [ ] **Step 15.1: Implementation sketch**

```ts
// packages/vite/src/devtools-strip.ts (new)
import babel from '@babel/core'
import tsPreset from '@babel/preset-typescript'
import type { Plugin } from 'vite'

const STRIP_IMPORT_PATTERNS = [
  /^@forinda\/kickjs-devtools(\/.*)?$/,
  /^@forinda\/kickjs-devtools-kit(\/.*)?$/,
]

export function devtoolsStrip(opts: { requireUrlFlag?: string } = {}): Plugin {
  return {
    name: '@forinda/kickjs-vite/devtools-strip',
    apply: 'build',
    transform(code, id) {
      if (!/\.(?:tsx?|jsx?)$/.test(id)) return
      const result = babel.transformSync(code, {
        filename: id,
        presets: [[tsPreset, { isTSX: id.endsWith('tsx'), allExtensions: true }]],
        plugins: [stripDevtoolsImports()],
      })
      return result?.code ?? null
    },
  }
}

function stripDevtoolsImports(): babel.PluginObj {
  return {
    visitor: {
      ImportDeclaration(path) {
        const src = path.node.source.value
        if (STRIP_IMPORT_PATTERNS.some((p) => p.test(src))) path.remove()
      },
      JSXElement(path) {
        const opening = path.node.openingElement
        if (
          opening.name.type === 'JSXIdentifier' &&
          /^Kick(?:Js)?Devtools$/.test(opening.name.name)
        ) {
          path.remove()
        }
      },
    },
  }
}
```

- [ ] **Step 15.2: Wire into the existing `kickjs()` Vite plugin**

```ts
// packages/vite/src/index.ts (extend)
import { devtoolsStrip } from './devtools-strip'

export function kickjs(opts: KickjsOptions = {}): Plugin[] {
  const plugins: Plugin[] = [
    /* existing plugins… */
  ]
  if (opts.devtools?.stripOnBuild ?? true) {
    plugins.push(devtoolsStrip(opts.devtools))
  }
  return plugins
}
```

- [ ] **Step 15.3: Test**

```ts
// packages/vite/__tests__/devtools-strip.test.ts
import { describe, it, expect } from 'vitest'
import { build } from 'vite'

describe('devtoolsStrip', () => {
  it('removes @forinda/kickjs-devtools imports from prod bundle', async () => {
    // configure with kickjs() plugin + a fixture entry that imports devtools
    // assert the resulting bundle has zero matches for /kickjs-devtools/
    expect(true).toBe(true) // sketch — fill in fixture path on implementation
  })
})
```

- [ ] **Step 15.4: Commit**

```bash
git commit -m "feat(vite): devtoolsStrip — Babel transform removes devtools imports + JSX from prod (M2.E-T15)"
```

---

# Sub-milestone M2.F — DB query/extension API

## Task 16: `customType<T>()` mapper

**Story:** architecture §6 + spec §11.
**Files:**

- Create: `packages/db/src/custom-type.ts`

- [ ] **Step 16.1: Implementation**

```ts
// packages/db/src/custom-type.ts
import { ColumnBuilder } from './dsl/columns/types'

export interface CustomTypeOptions<TJs, TDriver = unknown> {
  dataType: () => string
  toDriver?: (value: TJs) => TDriver
  fromDriver?: (driver: TDriver) => TJs
}

export class CustomColumnBuilder<TJs> extends ColumnBuilder<TJs, true> {
  readonly toDriver?: (v: TJs) => unknown
  readonly fromDriver?: (d: unknown) => TJs

  constructor(opts: CustomTypeOptions<TJs>) {
    super(opts.dataType())
    this.toDriver = opts.toDriver as never
    this.fromDriver = opts.fromDriver as never
  }
}

export function customType<TJs>(opts: CustomTypeOptions<TJs>): () => CustomColumnBuilder<TJs> {
  return () => new CustomColumnBuilder<TJs>(opts)
}
```

> The Kysely runtime side (`toDriver` / `fromDriver` invoked at insert/select) is
> wired via a Kysely plugin that consumes the column metadata. That plugin lands
> in M2-T19 (lifecycle hooks pipeline).

- [ ] **Step 16.2: Test**

```ts
// packages/db/__tests__/unit/custom-type.test.ts
// expectTypeOf: customType<EncryptedString>()() returns CustomColumnBuilder<EncryptedString>
// expectTypeOf: SchemaToKysely propagates EncryptedString to the column type
```

- [ ] **Step 16.3: Commit**

```bash
git commit -m "feat(db): customType<T>() mapper for typed column transforms (M2.F-T16)"
```

---

## Task 17: `$extends({ model, result })`

**Story:** architecture §6.
**Files:**

- Create: `packages/db/src/extend/types.ts`
- Create: `packages/db/src/extend/apply.ts`
- Modify: `packages/db/src/client/types.ts` (add `$extends` method)

- [ ] **Step 17.1: Types** (sketch — full inference is non-trivial)

```ts
// packages/db/src/extend/types.ts
export interface ResultExtension<Row> {
  needs: Partial<Record<keyof Row, true>>
  compute: (row: Row) => unknown
}

export interface ExtensionDefinition<DB> {
  model?: { [Table in keyof DB]?: Record<string, (...args: unknown[]) => unknown> }
  result?: { [Table in keyof DB]?: Record<string, ResultExtension<DB[Table]>> }
}
```

- [ ] **Step 17.2: Runtime apply** — wraps the existing `KickDbClient` so model
      methods land on `dbX.<table>.<method>`, result extensions intercept select rows
      and run `compute()` post-fetch.

- [ ] **Step 17.3: Tests + commit**

```bash
git commit -m "feat(db): \$extends({ model, result }) extension surface (M2.F-T17)"
```

---

## Task 18: `db.query.X.findMany({ with })` relational layer

**Story:** architecture §6 (Layer 3).

The biggest task in M2 — proper relational query compilation to a single SQL with
JSON aggregation per dialect (PG `json_agg`, etc.). Defer detailed design to a
separate sub-spec written when M2.F starts; this plan reserves the milestone
slot. Estimated 1 week of focused work.

```bash
git commit -m "feat(db): db.query.X.findMany({ with }) relational layer (M2.F-T18)"
```

---

## Task 19: Lifecycle hooks runtime emit + slow-query threshold

**Story:** architecture §6 + spec §5.4.
**Files:**

- Create: `packages/db/src/hooks/plugin.ts` — Kysely interceptor
- Create: `packages/db/src/hooks/slow-query.ts`

- [ ] **Step 19.1: Kysely plugin that wires the existing `KickDbEventEmitter`**

```ts
// packages/db/src/hooks/plugin.ts
import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  RootOperationNode,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
} from 'kysely'
import { KickDbEventEmitter } from '../client/events'

export class HooksPlugin implements KyselyPlugin {
  constructor(
    private events: KickDbEventEmitter,
    private slowQueryThresholdMs: number | null,
  ) {}

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    // record start time keyed by queryId
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result
  }

  // Wrap kysely.executeQuery via a thin facade in createDbClient — emits
  // beforeQuery (mutable), query (success), queryError (failure), slowQuery
  // when durationMs > slowQueryThresholdMs.
}
```

- [ ] **Step 19.2: `slowQueryThresholdMs` plumbing**

`createDbClient({ slowQueryThresholdMs: 50 })` config flows through to the
hooks plugin.

- [ ] **Step 19.3: Tests + commit**

```bash
git commit -m "feat(db): runtime emit pipeline for query / queryError / slowQuery (M2.F-T19)"
```

---

# Sub-milestone M2.G — Documentation + 14-table example port

## Task 20: Guide pages

**Story:** all three specs need adopter-facing docs.

Create:

- `docs/guide/db-schema-types.md` — explains phantom inference + Register pattern
- `docs/guide/devtools-plugins.md` — plugin contract + adopter examples
- `docs/guide/event-bus.md` — KickEventBus, registry pattern, examples
- `docs/guide/typegen-plugins.md` — TypegenPlugin contract, drift detection
- `docs/guide/db-extensions.md` — customType + $extends patterns
- Update `docs/guide/typegen.md` (existing) with the plugin model

```bash
git commit -m "docs(db): M2 guide pages — schema-types, devtools-plugins, event-bus, typegen-plugins (M2.G-T20)"
```

## Task 21: Full 14-table port of `task-prisma-api`

The deferred port from M1. Now feasible because the type story is precise — the
14 tables won't drift via manual `interface DB`. Replace the M1 minimal three-table
port with the full schema (`workspaces`, `members`, `projects`, `tasks`, `comments`,
`attachments`, `channels`, `messages`, `notifications`, `activities`, `users`,
`refresh_tokens`, `task_assignees`, `labels`).

```bash
git commit -m "example(task-kickdb-api): full 14-table port of task-prisma-api (M2.G-T21)"
```

## Task 22: Release notes + version bump

```bash
node scripts/release.js minor:dry  # M2 ships as v6.1 or v6.0; decide based on breaking-change accumulation
git commit -m "chore: M2 release notes (M2.G-T22)"
```

---

# M2 exit gate

After all sub-milestones:

```bash
pnpm build           # all packages compile
pnpm test            # full test suite (unit + integration on PG)
pnpm format:check    # clean
pnpm exec kick typegen --check   # zero drift across all built-in + adopter plugins

# Manual smoke
cd examples/task-kickdb-api
pnpm db:generate add_some_field   # generator picks up schema change
pnpm db:migrate                   # applies to real PG
pnpm dev                          # boots, all 14 modules wire through DI
```

What works after M2:

1. **Adopters never hand-write column types.** Schema is the source of truth;
   types follow automatically via phantom generics + Register.
2. **`kick typegen` is pluggable.** `kick/routes`, `kick/env`, `kick/assets`,
   `kick/db` are TypegenPlugins — adopters register OpenAPI / GraphQL / Redis
   / forms generators uniformly.
3. **DevTools plugin contract is `(el, props) => void`.** Adapter packages ship
   tabs in any UI framework; host shell stays neutral.
4. **`KickEventBus` ties devtools, dev server, and adapters together.** Typed
   events via `KickDevtoolsEventRegistry` augmentation. Cross-tab + server→client.
5. **Vite plugin strips devtools from prod by default.** Belt-and-suspenders
   runtime guard remains.
6. **`customType<T>()` and `$extends({ model, result })` ship.** Encrypted
   columns, soft-delete, derived fields all expressible.
7. **`db.query.X.findMany({ with })` ships.** No-N+1 relational queries with JSON
   aggregation per dialect.
8. **The full 14-table example app ports cleanly.** Real-world surface validates
   the type story.

---

# Plan self-review

Spec coverage:

| Spec                                                | Where it lands |
| --------------------------------------------------- | -------------- |
| spec-auto-schema-typing L1 (phantom column tagging) | M2.A T1        |
| spec-auto-schema-typing L2 (`SchemaToKysely`)       | M2.A T3        |
| spec-auto-schema-typing L3 (`Register`)             | M2.A T4        |
| spec-auto-schema-typing L4 (kick db typegen)        | M2.B T9        |
| spec-platform §4 (DevTools plugin contract)         | M2.C T12       |
| spec-platform §5 (Multi-tier event bus)             | M2.D T13–T14   |
| spec-platform §6 (Pluggable typegen)                | M2.B T7–T11    |
| spec-platform §7 (Vite AST strip)                   | M2.E T15       |
| architecture §6 ($extends, customType, db.query)    | M2.F T16–T18   |
| architecture §6 (lifecycle hooks runtime emit)      | M2.F T19       |
| architecture §6 (slow query)                        | M2.F T19       |

Type consistency: `Register` interface is the single integration point —
appears in `@forinda/kickjs-db` (DB schema), `@forinda/kickjs-devtools-kit`
(`KickDevtoolsEventRegistry`), and any adopter-shipped TypegenPlugin's emitted
augmentation file. One pattern, three usages.

Placeholders: a few — `M2.F-T18` (relational `db.query`) defers detailed design
to a sub-spec at execution time; `M2.E-T15` references an existing
`packages/vite` Vite plugin shape that should be read before extending. Both
called out inline.

Out of scope for M2 (deferred to M3 or later):

- SQLite / MySQL adapters (M3 + M6 per architecture spec roadmap).
- Edge runtime entry point.
- Studio.
- View / materialized view / trigger introspection.
- TanStack Start-style RPC.

---

**Plan complete and saved to `docs/db/m2-plan.md`.** Sequenceable inline by the
existing `superpowers:executing-plans` workflow, or via `subagent-driven-
development` for parallel sub-milestones (M2.C/D/E ship in parallel after M2.A
lands).

Pick execution mode and target sub-milestone to start.
