# M1 — Walking Skeleton: Implementation Plan

> **Status:** ✅ **Shipped** — runner / introspect / drift / `db-pg` adapter / `examples/task-kickdb-api` all landed before M2 (commit `0b5de4d` cited as M2 prereq). Checklist marked `[x]` on 2026-05-05; doc is historical.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end working ORM on Postgres. After M1, an adopter can declare a TS schema, generate + apply reversible migrations against a real database, and execute typed Kysely queries through a KickJS-DI-injected client. The example app `examples/task-kickdb-api` boots and serves real HTTP endpoints backed by the new ORM.

**Architecture:** Schema DSL → migration files (already M0). New: `_journal.json` integrity, `kick_migrations` + lock tables, runner subcommands, PG drift detection, `KickDbClient` wrapping Kysely with a thin events/savepoint/streaming layer, `kickDbAdapter()` via `defineAdapter()`, DI tokens (`DB_PRIMARY`, `DB_REPLICA`), one DDD example.

**Tech Stack:** TypeScript, Vitest + SWC, tsdown, wireit, `kysely` (typed query core), `pg` (driver, peer dep of `db-pg`), Testcontainers (CI integration tests).

**Spec:** [`./architecture.md`](./architecture.md) — sections 4 (Schema DSL), 5 (Migration engine), 6 (Client), 7 (KickJS integration), 13 (Roadmap M1).
**Stories:** [`./stories.md`](./stories.md) — M1-S1 through M1-S10.
**M0 context:** [`./m0-spike-plan.md`](./m0-spike-plan.md) — schema DSL, diff engine, PG emitter, `kick db generate` are already shipped on `feat/db`.

> **M1-S2 was brought forward into M0** (commit `f7c0c5b` — down.sql, REVIEWED+DRAFT markers, `meta.previousId`). It's not a task in this plan.

---

## File Structure

New within `packages/db/`:

```
packages/db/src/
  migrate/                      Migration runner core
    journal.ts                  Task 6:  _journal.json read/write + hash verify
    schema.ts                   Task 7:  kick_migrations + kick_migrations_lock DDL
    lock.ts                     Task 8:  acquire/release lock atomically per dialect
    adapter.ts                  Task 7:  MigrationAdapter interface (PG/SQLite/MySQL plug-in)
    runner.ts                   Tasks 9-13: latest/up/down/rollback/status
    drift.ts                    Tasks 14-15: introspect + compare to snapshot
    introspect-pg.ts            Task 14: PG introspection via information_schema
    errors.ts                   Tasks 7-15: MigrationLockError, MigrationDriftError, etc.
  client/
    types.ts                    Task 19: KickDbClient surface (events + transaction + savepoint)
    create.ts                   Task 19: createDbClient({ schema, adapter }) → wraps Kysely
    events.ts                   Task 19: on('query'|'queryError'|...) emitter
    schema-types.ts             Task 20: SchemaToKysely<T> mapping the schema export to Kysely's DB type
  adapter.ts                    Task 16: kickDbAdapter() via defineAdapter
  tokens.ts                     Task 22: DB_PRIMARY / DB_REPLICA / DB_CLIENT
  errors.ts                     Tasks 7-15: re-export migrate/errors and add KickDbError base

packages/db/__tests__/
  unit/
    journal.test.ts                          Task 6
    migrate-tables.test.ts                   Task 7
    lock.test.ts                             Task 8
    runner-latest.test.ts                    Task 9
    runner-up-down.test.ts                   Tasks 10, 11
    runner-rollback.test.ts                  Task 12
    runner-status.test.ts                    Task 13
    drift.test.ts                            Tasks 14, 15
    adapter.test.ts                          Task 16
    boot-policy.test.ts                      Task 17
    client-events.test.ts                    Task 19
    schema-types.test-d.ts                   Task 20 (type-only test)
    layer1-queries.test.ts                   Task 21
    di-tokens.test.ts                        Task 22
  integration/
    pg-runner.test.ts                        Tasks 9-13 against real PG
    pg-drift.test.ts                         Tasks 14-15
    pg-client.test.ts                        Task 21
```

New package:

```
packages/db-pg/                              Tasks 16, 19 — node-postgres adapter
  package.json
  tsconfig.json
  tsconfig.test.json
  tsdown.config.ts
  vitest.config.ts
  README.md
  LICENSE
  src/
    index.ts                                 barrel
    adapter.ts                               pgAdapter() factory implementing KickDbAdapter
    introspect.ts                            re-export from kickjs-db introspect-pg
  __tests__/
    integration/
      adapter.test.ts                        End-to-end run against a Postgres container
```

CLI command additions (`packages/cli/src/commands/db.ts`):

```
Tasks 9-13: latest, up, down, rollback, status subcommands
Task 14:    introspect subcommand
```

New example (last task block):

```
examples/task-kickdb-api/                    Tasks 23-25
  (full DDD module port of examples/task-prisma-api)
```

---

## Conventions

Same as M0:

- **TDD**: failing test → minimal code → green → commit. One commit per task. Conventional Commits.
- **No `--no-verify`** on commits. Pre-commit runs `build → test → format:check`.
- **Always `pnpm`** from repo root with absolute paths. Don't `cd` to subdirs.
- **Format proactively** with `pnpm prettier --write <files>` before staging.
- **All file edits** use `Edit`/`Write` tools (not `sed`/`echo`).

Branch: `feat/db` (continues M0).

Memory rules to honor (from MEMORY.md):

- **Only write to `packages/db` and the new `packages/db-pg`** — never `packages/core` or `packages/http` (consolidated into `packages/kickjs`).
- **Adapters use `defineAdapter()`** — never `class implements AppAdapter` (M1-S7).
- **Tests use `Container.create()`** — never `new Container()` or `getInstance().reset()` (M1-S7, S9).
- **Context Contributors** preferred for ctx-population (none needed in M1, but keep the rule in mind).
- **No `setRequestValue`** — writes via `ctx.set` or contributor return; reads via `ctx.get`/`getRequestValue`. (Doesn't apply directly to M1.)
- **`defineAdapter` everywhere + generator full surface** — adopters delete-to-discover. Apply when writing the kickDbAdapter.

---

## Task 1: Full PG numeric + integer column types

**Story:** M1-S1.
**Files:**

- Modify: `packages/db/src/dsl/columns/builders.ts`
- Modify: `packages/db/src/dsl/columns/index.ts`
- Create: `packages/db/__tests__/unit/columns-numeric.test.ts`

- [x] **Step 1.1: Write the failing test**

```ts
// packages/db/__tests__/unit/columns-numeric.test.ts
import { describe, it, expect } from 'vitest'
import {
  bigSerial,
  bigint,
  smallint,
  decimal,
  numeric,
  real,
  doublePrecision,
} from '@forinda/kickjs-db'

describe('numeric column builders', () => {
  it('bigSerial defaults to NOT NULL like serial', () => {
    expect(bigSerial().toJSON('id')).toEqual({
      name: 'id',
      type: 'bigserial',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('bigint / smallint emit canonical PG types', () => {
    expect(bigint().toJSON('big').type).toBe('bigint')
    expect(smallint().toJSON('s').type).toBe('smallint')
  })

  it('decimal(precision, scale) parameterizes', () => {
    expect(decimal(10, 2).toJSON('amount').type).toBe('decimal(10, 2)')
    expect(decimal().toJSON('amount').type).toBe('decimal')
  })

  it('numeric is alias-shaped (same parameterization)', () => {
    expect(numeric(8, 4).toJSON('x').type).toBe('numeric(8, 4)')
  })

  it('real / doublePrecision are bare types', () => {
    expect(real().toJSON('r').type).toBe('real')
    expect(doublePrecision().toJSON('d').type).toBe('double precision')
  })
})
```

- [x] **Step 1.2: Run — fails on missing exports**

```bash
pnpm --filter @forinda/kickjs-db test
```

- [x] **Step 1.3: Add the builders**

Append to `packages/db/src/dsl/columns/builders.ts`:

```ts
export function bigSerial(): ColumnBuilder {
  return new ColumnBuilder('bigserial', { nullable: false })
}

export function bigint(): ColumnBuilder {
  return new ColumnBuilder('bigint')
}

export function smallint(): ColumnBuilder {
  return new ColumnBuilder('smallint')
}

export function decimal(precision?: number, scale?: number): ColumnBuilder {
  return new ColumnBuilder(formatNumeric('decimal', precision, scale))
}

export function numeric(precision?: number, scale?: number): ColumnBuilder {
  return new ColumnBuilder(formatNumeric('numeric', precision, scale))
}

export function real(): ColumnBuilder {
  return new ColumnBuilder('real')
}

export function doublePrecision(): ColumnBuilder {
  return new ColumnBuilder('double precision')
}

function formatNumeric(base: string, precision?: number, scale?: number): string {
  if (precision === undefined) return base
  if (scale === undefined) return `${base}(${precision})`
  return `${base}(${precision}, ${scale})`
}
```

- [x] **Step 1.4: Re-export from `index.ts`**

```ts
// packages/db/src/dsl/columns/index.ts — add to the existing list
export {
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  TimestampBuilder,
  bigSerial,
  bigint,
  smallint,
  decimal,
  numeric,
  real,
  doublePrecision,
} from './builders'
```

- [x] **Step 1.5: Run — passes**

- [x] **Step 1.6: Commit**

```bash
git add packages/db/src/dsl/columns packages/db/__tests__/unit/columns-numeric.test.ts
git commit -m "feat(db): add bigSerial/bigint/smallint/decimal/numeric/real/doublePrecision (M1-S1)"
```

---

## Task 2: Date/time + uuid column types

**Story:** M1-S1.
**Files:** `packages/db/src/dsl/columns/builders.ts`, `index.ts`, `packages/db/__tests__/unit/columns-temporal.test.ts`

- [x] **Step 2.1: Test**

```ts
// packages/db/__tests__/unit/columns-temporal.test.ts
import { describe, it, expect } from 'vitest'
import { char, timestamptz, date, time, interval, uuid } from '@forinda/kickjs-db'

describe('temporal + identity column builders', () => {
  it('char(n) parameterizes', () => {
    expect(char(2).toJSON('cc').type).toBe('char(2)')
  })

  it('char() defaults length 1', () => {
    expect(char().toJSON('cc').type).toBe('char(1)')
  })

  it('timestamptz', () => {
    expect(timestamptz().toJSON('t').type).toBe('timestamptz')
  })

  it('date / time / interval', () => {
    expect(date().toJSON('d').type).toBe('date')
    expect(time().toJSON('t').type).toBe('time')
    expect(interval().toJSON('i').type).toBe('interval')
  })

  it('uuid().defaultRandom() resolves to gen_random_uuid()', () => {
    const col = uuid().defaultRandom().toJSON('id')
    expect(col.type).toBe('uuid')
    expect(col.default).toBe('gen_random_uuid()')
  })
})
```

- [x] **Step 2.2: Implement**

```ts
// Append to packages/db/src/dsl/columns/builders.ts
export function char(length = 1): ColumnBuilder {
  return new ColumnBuilder(`char(${length})`)
}

export function timestamptz(): TimestampBuilder {
  // Reuse TimestampBuilder so .defaultNow() works.
  const b = new TimestampBuilder()
  ;(b as unknown as { state: { type: string } }).state.type = 'timestamptz'
  return b
}

export function date(): ColumnBuilder {
  return new ColumnBuilder('date')
}

export function time(): ColumnBuilder {
  return new ColumnBuilder('time')
}

export function interval(): ColumnBuilder {
  return new ColumnBuilder('interval')
}

export class UuidBuilder extends ColumnBuilder {
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

Add the casts cleanly: extract `state` access via a `protected` member already in `ColumnBuilder`. The builder's `state` is `protected`, so this needs a small change in `types.ts` — make `state` protected (already is) and add a protected setter:

Actually update the design — `timestamptz()` should not bash internal state. Instead, factor `TimestampBuilder` to accept the type name:

Replace `TimestampBuilder` in `builders.ts` with:

```ts
export class TimestampBuilder extends ColumnBuilder {
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
```

This is internal — no public API change.

Update the export sweep. Update `formatDefault` in `emit/pg.ts` to also leave `gen_random_uuid()` bare (already covered if we add another `if` for that pattern). Actually look at the existing `formatDefault`:

```ts
if (upper === 'CURRENT_TIMESTAMP' || upper === 'NOW()') return value
```

Extend to a general "looks like a function call" rule:

```ts
function formatDefault(value: string): string {
  // Bare-passthrough: SQL keywords, function calls, numeric/boolean literals.
  if (/^[A-Z_]+(\s*\(\s*\))?$/i.test(value)) return value // CURRENT_TIMESTAMP, NOW()
  if (/^[a-z_][a-z0-9_]*\s*\([^)]*\)$/i.test(value)) return value // gen_random_uuid()
  if (/^-?\d+(\.\d+)?$/.test(value)) return value
  if (value === 'true' || value === 'false') return value
  return quoteLiteral(value)
}
```

Verify with a unit test: existing `emit-pg-create-drop.test.ts` covers `serial NOT NULL` etc; nothing tests `gen_random_uuid()` yet — add one in `columns-temporal.test.ts` or rely on the integration test in Task 25 to catch.

- [x] **Step 2.3: Run — passes**

- [x] **Step 2.4: Commit**

```bash
git commit -m "feat(db): add char/timestamptz/date/time/interval/uuid column types (M1-S1)"
```

---

## Task 3: JSON / JSONB / bytea column types + array() modifier

**Story:** M1-S1.
**Files:** `packages/db/src/dsl/columns/builders.ts`, `types.ts`, `index.ts`, `packages/db/__tests__/unit/columns-json-array.test.ts`

- [x] **Step 3.1: Test**

```ts
import { describe, it, expect } from 'vitest'
import { json, jsonb, bytea, integer, varchar } from '@forinda/kickjs-db'

describe('json/jsonb/bytea + array', () => {
  it('json column with phantom type parameter', () => {
    const col = json<{ tags: string[] }>().toJSON('meta')
    expect(col.type).toBe('json')
  })

  it('jsonb column', () => {
    expect(jsonb<{ x: number }>().toJSON('m').type).toBe('jsonb')
  })

  it('bytea column', () => {
    expect(bytea().toJSON('blob').type).toBe('bytea')
  })

  it('integer().array() yields integer[]', () => {
    expect(integer().array().toJSON('xs').type).toBe('integer[]')
  })

  it('varchar(255).array() yields varchar(255)[]', () => {
    expect(varchar(255).array().toJSON('xs').type).toBe('varchar(255)[]')
  })
})
```

- [x] **Step 3.2: Implement**

In `builders.ts`:

```ts
export function json<_T = unknown>(): ColumnBuilder {
  return new ColumnBuilder('json')
}

export function jsonb<_T = unknown>(): ColumnBuilder {
  return new ColumnBuilder('jsonb')
}

export function bytea(): ColumnBuilder {
  return new ColumnBuilder('bytea')
}
```

In `types.ts`, add the `array()` chain method on `ColumnBuilder`:

```ts
  array(): this {
    this.state.type = `${this.state.type}[]`
    return this
  }
```

Re-export `json`, `jsonb`, `bytea` from `index.ts`.

- [x] **Step 3.3: Run — passes**

- [x] **Step 3.4: Commit**

```bash
git commit -m "feat(db): add json/jsonb/bytea + .array() modifier (M1-S1)"
```

---

## Task 4: PG-only subpath exports — vector / citext / money / inet / cidr / xml / tsvector

**Story:** M1-S1.
**Files:**

- Create: `packages/db/src/dsl/columns/pg.ts`
- Modify: `packages/db/package.json` (add `./pg` subpath export)
- Modify: `packages/db/tsdown.config.ts` (add the `pg` entry)
- Create: `packages/db/__tests__/unit/columns-pg.test.ts`

- [x] **Step 4.1: Test**

```ts
// packages/db/__tests__/unit/columns-pg.test.ts
import { describe, it, expect } from 'vitest'
import { tsvector, vector, citext, money, inet, cidr, xml } from '@forinda/kickjs-db/pg'

describe('PG-only column types', () => {
  it('vector(384)', () => {
    expect(vector(384).toJSON('embedding').type).toBe('vector(384)')
  })

  it('vector() unbounded', () => {
    expect(vector().toJSON('embedding').type).toBe('vector')
  })

  it('citext / money / inet / cidr / xml / tsvector', () => {
    expect(citext().toJSON('x').type).toBe('citext')
    expect(money().toJSON('x').type).toBe('money')
    expect(inet().toJSON('x').type).toBe('inet')
    expect(cidr().toJSON('x').type).toBe('cidr')
    expect(xml().toJSON('x').type).toBe('xml')
    expect(tsvector().toJSON('x').type).toBe('tsvector')
  })
})
```

- [x] **Step 4.2: Implement**

```ts
// packages/db/src/dsl/columns/pg.ts
import { ColumnBuilder } from './types'

export function tsvector(): ColumnBuilder {
  return new ColumnBuilder('tsvector')
}
export function vector(dim?: number): ColumnBuilder {
  return new ColumnBuilder(dim === undefined ? 'vector' : `vector(${dim})`)
}
export function citext(): ColumnBuilder {
  return new ColumnBuilder('citext')
}
export function money(): ColumnBuilder {
  return new ColumnBuilder('money')
}
export function inet(): ColumnBuilder {
  return new ColumnBuilder('inet')
}
export function cidr(): ColumnBuilder {
  return new ColumnBuilder('cidr')
}
export function xml(): ColumnBuilder {
  return new ColumnBuilder('xml')
}
```

- [x] **Step 4.3: Wire subpath**

`packages/db/package.json` — add to `exports`:

```json
"./pg": {
  "import": "./dist/pg.mjs",
  "types": "./dist/pg.d.mts"
}
```

`packages/db/tsdown.config.ts`:

```ts
entry: {
  index: 'src/index.ts',
  pg: 'src/dsl/columns/pg.ts',
},
```

`packages/db/tsconfig.test.json` — add path alias:

```json
"paths": {
  "@forinda/kickjs-db": ["src/index.ts"],
  "@forinda/kickjs-db/pg": ["src/dsl/columns/pg.ts"],
  ...
}
```

`packages/db/vitest.config.ts` — add resolve alias:

```ts
'@forinda/kickjs-db/pg': path.resolve(__dirname, 'src/dsl/columns/pg.ts'),
```

- [x] **Step 4.4: Run — build + test pass**

- [x] **Step 4.5: Commit**

```bash
git commit -m "feat(db): add @forinda/kickjs-db/pg subpath with vector/citext/money/inet/cidr/xml/tsvector (M1-S1)"
```

---

## Task 5: Migration error hierarchy

**Story:** M1-S3 through S6 share these.
**Files:**

- Create: `packages/db/src/migrate/errors.ts`
- Create: `packages/db/src/errors.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/errors.test.ts`

- [x] **Step 5.1: Test**

```ts
import { describe, it, expect } from 'vitest'
import {
  KickDbError,
  MigrationError,
  MigrationLockError,
  MigrationDriftError,
  MigrationHashError,
  UnreviewedMigrationError,
} from '@forinda/kickjs-db'

describe('error hierarchy', () => {
  it('every migration error inherits from MigrationError and KickDbError', () => {
    const errs = [
      new MigrationLockError('locked'),
      new MigrationDriftError('drift', { added: ['x'], removed: [], changed: [] }),
      new MigrationHashError('20260427_init', 'expected', 'actual'),
      new UnreviewedMigrationError('20260427_init'),
    ]
    for (const e of errs) {
      expect(e).toBeInstanceOf(MigrationError)
      expect(e).toBeInstanceOf(KickDbError)
      expect(e).toBeInstanceOf(Error)
      expect(typeof e.code).toBe('string')
    }
  })

  it('MigrationDriftError carries the diff payload', () => {
    const e = new MigrationDriftError('schema drifted', {
      added: ['users.foo'],
      removed: ['users.bar'],
      changed: [],
    })
    expect(e.diff.added).toEqual(['users.foo'])
  })
})
```

- [x] **Step 5.2: Implement**

```ts
// packages/db/src/errors.ts
export class KickDbError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = this.constructor.name
    this.code = code
  }
}
```

```ts
// packages/db/src/migrate/errors.ts
import { KickDbError } from '../errors'

export class MigrationError extends KickDbError {}

export class MigrationLockError extends MigrationError {
  constructor(message: string) {
    super('migration_lock_held', message)
  }
}

export interface SchemaDiffSummary {
  added: string[]
  removed: string[]
  changed: string[]
}

export class MigrationDriftError extends MigrationError {
  readonly diff: SchemaDiffSummary
  constructor(message: string, diff: SchemaDiffSummary) {
    super('migration_drift', message)
    this.diff = diff
  }
}

export class MigrationHashError extends MigrationError {
  readonly id: string
  readonly expected: string
  readonly actual: string
  constructor(id: string, expected: string, actual: string) {
    super('migration_hash_mismatch', `Hash mismatch for migration ${id}`)
    this.id = id
    this.expected = expected
    this.actual = actual
  }
}

export class UnreviewedMigrationError extends MigrationError {
  readonly id: string
  constructor(id: string) {
    super(
      'migration_unreviewed',
      `Migration ${id} has -- REVIEWED: false; flip the marker before applying outside dev`,
    )
    this.id = id
  }
}
```

Re-export from `index.ts`:

```ts
export { KickDbError } from './errors'
export {
  MigrationError,
  MigrationLockError,
  MigrationDriftError,
  MigrationHashError,
  UnreviewedMigrationError,
  type SchemaDiffSummary,
} from './migrate/errors'
```

- [x] **Step 5.3: Run — passes; commit**

```bash
git commit -m "feat(db): add KickDbError + Migration* error hierarchy (M1-S3..S6)"
```

---

## Task 6: `_journal.json` read/write + hash verification

**Story:** M1-S3.
**Files:**

- Create: `packages/db/src/migrate/journal.ts`
- Modify: `packages/db/src/cli/generate.ts` (write to `_journal.json` on each generate)
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/journal.test.ts`

The journal is the integrity-checked, ordered list of every committed migration. It lives at `<migrationsDir>/_journal.json`:

```json
{
  "version": 1,
  "dialect": "postgres",
  "entries": [
    {
      "id": "20260427_153012_init",
      "tag": "init",
      "hash": "sha256:...",
      "createdAt": "2026-04-27T..."
    }
  ]
}
```

Hash = `sha256(up.sql + down.sql + snapshot.json)`. Tampering with applied migrations later fails the integrity check at `migrate latest` time.

- [x] **Step 6.1: Test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  readJournal,
  appendJournalEntry,
  computeMigrationHash,
  verifyMigrationHash,
} from '@forinda/kickjs-db'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-journal-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('journal', () => {
  it('readJournal returns an empty journal when the file is absent', async () => {
    const j = await readJournal(dir, 'postgres')
    expect(j).toEqual({ version: 1, dialect: 'postgres', entries: [] })
  })

  it('appendJournalEntry writes the file atomically', async () => {
    const entry = {
      id: '20260427_init',
      tag: 'init',
      hash: 'sha256:abc',
      createdAt: '2026-04-27T00:00:00.000Z',
    }
    await appendJournalEntry(dir, 'postgres', entry)
    const j = await readJournal(dir, 'postgres')
    expect(j.entries).toEqual([entry])
  })

  it('computeMigrationHash hashes up.sql + down.sql + snapshot.json deterministically', async () => {
    const mig = path.join(dir, '20260427_init')
    await mkdir(mig, { recursive: true })
    await writeFile(path.join(mig, 'up.sql'), 'CREATE TABLE x;', 'utf8')
    await writeFile(path.join(mig, 'down.sql'), 'DROP TABLE x;', 'utf8')
    await writeFile(path.join(mig, 'snapshot.json'), '{"x":1}', 'utf8')
    const h1 = await computeMigrationHash(mig)
    const h2 = await computeMigrationHash(mig)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('verifyMigrationHash rejects on mismatch', async () => {
    const mig = path.join(dir, '20260427_init')
    await mkdir(mig, { recursive: true })
    await writeFile(path.join(mig, 'up.sql'), 'A', 'utf8')
    await writeFile(path.join(mig, 'down.sql'), 'B', 'utf8')
    await writeFile(path.join(mig, 'snapshot.json'), 'C', 'utf8')
    const h = await computeMigrationHash(mig)
    await expect(verifyMigrationHash(mig, h)).resolves.toBe(true)
    await expect(verifyMigrationHash(mig, 'sha256:000')).resolves.toBe(false)
  })
})
```

- [x] **Step 6.2: Implement**

```ts
// packages/db/src/migrate/journal.ts
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Dialect } from '../snapshot/types'

export interface JournalEntry {
  id: string
  tag: string
  hash: string
  createdAt: string
}

export interface Journal {
  version: 1
  dialect: Dialect
  entries: JournalEntry[]
}

const FILE = '_journal.json'

export async function readJournal(migrationsDir: string, dialect: Dialect): Promise<Journal> {
  const file = path.join(migrationsDir, FILE)
  if (!existsSync(file)) {
    return { version: 1, dialect, entries: [] }
  }
  const raw = JSON.parse(await readFile(file, 'utf8'))
  if (raw.version !== 1) {
    throw new Error(`_journal.json version ${raw.version} unsupported (expected 1)`)
  }
  return raw
}

export async function appendJournalEntry(
  migrationsDir: string,
  dialect: Dialect,
  entry: JournalEntry,
): Promise<void> {
  const j = await readJournal(migrationsDir, dialect)
  j.entries.push(entry)
  const file = path.join(migrationsDir, FILE)
  await writeFile(file, JSON.stringify(j, null, 2) + '\n', 'utf8')
}

export async function computeMigrationHash(migrationDir: string): Promise<string> {
  const up = await readFile(path.join(migrationDir, 'up.sql'), 'utf8')
  const down = await readFile(path.join(migrationDir, 'down.sql'), 'utf8')
  const snap = await readFile(path.join(migrationDir, 'snapshot.json'), 'utf8')
  const h = createHash('sha256')
    .update(up)
    .update('|')
    .update(down)
    .update('|')
    .update(snap)
    .digest('hex')
  return `sha256:${h}`
}

export async function verifyMigrationHash(
  migrationDir: string,
  expected: string,
): Promise<boolean> {
  const actual = await computeMigrationHash(migrationDir)
  return actual === expected
}
```

- [x] **Step 6.3: Wire into `generate()`**

After writing `up.sql` + `down.sql` + `snapshot.json` + `meta.json`, also append to the journal:

```ts
// packages/db/src/cli/generate.ts — at the end of writeMigration():
const hash = await computeMigrationHash(dir)
await appendJournalEntry(p.migrationsAbs, p.opts.config.dialect, {
  id,
  tag: p.opts.name,
  hash,
  createdAt: (p.opts.now?.() ?? new Date()).toISOString(),
})
```

- [x] **Step 6.4: Re-export from `index.ts`** + run + commit.

```bash
git commit -m "feat(db): add _journal.json with deterministic per-migration hashes (M1-S3)"
```

---

## Task 7: Migration tracking + lock-table DDL + adapter interface

**Story:** M1-S4.
**Files:**

- Create: `packages/db/src/migrate/adapter.ts`
- Create: `packages/db/src/migrate/schema.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/migrate-tables.test.ts`

The runner can't yet talk to a real DB — that comes via `MigrationAdapter` (a slim contract that `db-pg` will satisfy in Task 16). For now, define the interface + the cross-dialect DDL strings.

- [x] **Step 7.1: Define adapter interface**

```ts
// packages/db/src/migrate/adapter.ts
import type { Dialect } from '../snapshot/types'

export interface MigrationRow {
  id: string
  name: string
  hash: string
  batch: number
  appliedAt: string
  direction: 'up' | 'down'
}

export interface MigrationAdapter {
  readonly dialect: Dialect
  /** Idempotent CREATE TABLE IF NOT EXISTS for kick_migrations + kick_migrations_lock. */
  ensureMigrationTables(): Promise<void>
  /** Read all applied migrations ordered by appliedAt asc. */
  listApplied(): Promise<MigrationRow[]>
  /** Insert a new applied migration row. */
  recordApplied(row: Omit<MigrationRow, 'appliedAt'>): Promise<void>
  /** Delete an applied migration row (for `migrate down`). */
  removeApplied(id: string): Promise<void>
  /** Atomic lock acquire — returns true if we got it, false if held. */
  acquireLock(owner: string): Promise<boolean>
  /** Release the lock (no-op if not held). */
  releaseLock(): Promise<void>
  /** Run arbitrary SQL inside a transaction. Used to apply up.sql / down.sql. */
  applySqlInTx(sql: string): Promise<void>
  /** Apply SQL outside any transaction (for migrations with `meta.transaction: false`). */
  applySqlNoTx(sql: string): Promise<void>
  /** Introspect the live schema — returns the canonical SchemaSnapshot the diff engine consumes. Used by drift detection. */
  introspect(): Promise<import('../snapshot/types').SchemaSnapshot>
  /** Close any underlying pool / connection. */
  close(): Promise<void>
}
```

- [x] **Step 7.2: Cross-dialect DDL strings**

```ts
// packages/db/src/migrate/schema.ts
import type { Dialect } from '../snapshot/types'

export const KICK_MIGRATIONS_TABLE = 'kick_migrations'
export const KICK_LOCK_TABLE = 'kick_migrations_lock'

export function migrationsTableDdl(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}" (
        "id" varchar(128) PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "direction" varchar(8) NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}_batch_idx" ON "${KICK_MIGRATIONS_TABLE}" ("batch");`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" text NOT NULL DEFAULT (datetime('now')),
        "direction" text NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}_batch_idx" ON "${KICK_MIGRATIONS_TABLE}" ("batch");`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS \`${KICK_MIGRATIONS_TABLE}\` (
        \`id\` varchar(128) PRIMARY KEY,
        \`name\` text NOT NULL,
        \`hash\` text NOT NULL,
        \`batch\` int NOT NULL,
        \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`direction\` varchar(8) NOT NULL DEFAULT 'up',
        INDEX \`${KICK_MIGRATIONS_TABLE}_batch_idx\` (\`batch\`)
      );`
  }
}

export function lockTableDdl(dialect: Dialect): string {
  // Single-row lock: id = 1, locked_at present iff held, locked_by = process token.
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS "${KICK_LOCK_TABLE}" (
        "id" smallint PRIMARY KEY,
        "locked_at" timestamptz,
        "locked_by" text
      );
      INSERT INTO "${KICK_LOCK_TABLE}" ("id") VALUES (1) ON CONFLICT DO NOTHING;`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS "${KICK_LOCK_TABLE}" (
        "id" integer PRIMARY KEY,
        "locked_at" text,
        "locked_by" text
      );
      INSERT OR IGNORE INTO "${KICK_LOCK_TABLE}" ("id") VALUES (1);`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS \`${KICK_LOCK_TABLE}\` (
        \`id\` smallint PRIMARY KEY,
        \`locked_at\` timestamp NULL,
        \`locked_by\` text
      );
      INSERT IGNORE INTO \`${KICK_LOCK_TABLE}\` (\`id\`) VALUES (1);`
  }
}
```

- [x] **Step 7.3: Test the DDL is dialect-correct**

```ts
// packages/db/__tests__/unit/migrate-tables.test.ts
import { describe, it, expect } from 'vitest'
import { migrationsTableDdl, lockTableDdl } from '@forinda/kickjs-db'

describe('migration table DDL', () => {
  it('PG migrations table uses double-quoted identifiers', () => {
    const sql = migrationsTableDdl('postgres')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "kick_migrations"')
    expect(sql).toContain('"id" varchar(128) PRIMARY KEY')
  })

  it('PG lock seeds the single row idempotently', () => {
    const sql = lockTableDdl('postgres')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "kick_migrations_lock"')
    expect(sql).toContain(
      `INSERT INTO "kick_migrations_lock" ("id") VALUES (1) ON CONFLICT DO NOTHING`,
    )
  })

  it('SQLite uses INSERT OR IGNORE for lock seeding', () => {
    expect(lockTableDdl('sqlite')).toContain('INSERT OR IGNORE')
  })

  it('MySQL uses INSERT IGNORE + backticks', () => {
    expect(lockTableDdl('mysql')).toContain('INSERT IGNORE')
    expect(migrationsTableDdl('mysql')).toContain('`kick_migrations`')
  })
})
```

Re-export `MigrationAdapter`, `migrationsTableDdl`, `lockTableDdl`, `MigrationRow`, table-name constants from `index.ts`. Run + commit.

```bash
git commit -m "feat(db): MigrationAdapter contract + per-dialect kick_migrations/lock DDL (M1-S4)"
```

---

## Task 8: Lock acquisition strategy (in-memory adapter for tests)

**Story:** M1-S4.

The lock semantics need testing without spinning a Postgres container per test. Solution: ship a **memory adapter** in `@forinda/kickjs-db` itself for unit tests; the real `pg` adapter (Task 16) wires the same interface against a database.

**Files:**

- Create: `packages/db/src/migrate/memory-adapter.ts` (test fixture, exported)
- Create: `packages/db/__tests__/unit/lock.test.ts`
- Modify: `packages/db/src/index.ts`

- [x] **Step 8.1: Memory adapter**

```ts
// packages/db/src/migrate/memory-adapter.ts
import type { Dialect, SchemaSnapshot } from '../snapshot/types'
import type { MigrationAdapter, MigrationRow } from './adapter'

/**
 * In-memory MigrationAdapter for unit tests. Lock semantics are exact (single-
 * holder atomic), but applySqlInTx / applySqlNoTx / introspect are shaped as
 * test-only stubs — the real DB-bound semantics are validated in db-pg's
 * integration tests, not here.
 */
export class MemoryMigrationAdapter implements MigrationAdapter {
  readonly dialect: Dialect = 'postgres'

  private rows: MigrationRow[] = []
  private locked: { by: string; at: string } | null = null
  private appliedSql: string[] = []
  private currentSchema: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

  async ensureMigrationTables(): Promise<void> {
    /* no-op */
  }

  async listApplied(): Promise<MigrationRow[]> {
    return [...this.rows]
  }

  async recordApplied(row: Omit<MigrationRow, 'appliedAt'>): Promise<void> {
    this.rows.push({ ...row, appliedAt: new Date().toISOString() })
  }

  async removeApplied(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id)
  }

  async acquireLock(owner: string): Promise<boolean> {
    if (this.locked) return false
    this.locked = { by: owner, at: new Date().toISOString() }
    return true
  }

  async releaseLock(): Promise<void> {
    this.locked = null
  }

  async applySqlInTx(sql: string): Promise<void> {
    this.appliedSql.push(sql)
  }
  async applySqlNoTx(sql: string): Promise<void> {
    this.appliedSql.push(sql)
  }

  async introspect(): Promise<SchemaSnapshot> {
    return this.currentSchema
  }

  async close(): Promise<void> {
    /* no-op */
  }

  /** Test-only setter — let drift tests stage a "live" schema state. */
  __setIntrospectedSchema(snap: SchemaSnapshot): void {
    this.currentSchema = snap
  }

  /** Test-only inspector — what SQL we received. */
  __appliedSql(): readonly string[] {
    return this.appliedSql
  }
}
```

- [x] **Step 8.2: Lock test**

```ts
// packages/db/__tests__/unit/lock.test.ts
import { describe, it, expect } from 'vitest'
import { MemoryMigrationAdapter } from '@forinda/kickjs-db'

describe('MemoryMigrationAdapter lock', () => {
  it('acquireLock returns true on first call, false while held', async () => {
    const a = new MemoryMigrationAdapter()
    expect(await a.acquireLock('p1')).toBe(true)
    expect(await a.acquireLock('p2')).toBe(false)
  })

  it('releaseLock allows the next acquire', async () => {
    const a = new MemoryMigrationAdapter()
    await a.acquireLock('p1')
    await a.releaseLock()
    expect(await a.acquireLock('p2')).toBe(true)
  })
})
```

- [x] **Step 8.3: Re-export, run, commit**

```bash
git commit -m "feat(db): MemoryMigrationAdapter for unit tests (M1-S4)"
```

---

## Task 9: Runner — `migrate latest` (apply pending in a new batch)

**Story:** M1-S5.
**Files:**

- Create: `packages/db/src/migrate/runner.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/runner-latest.test.ts`

- [x] **Step 9.1: Runner skeleton**

```ts
// packages/db/src/migrate/runner.ts
import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { readJournal, computeMigrationHash } from './journal'
import { migrationsTableDdl, lockTableDdl } from './schema'
import { MigrationLockError, MigrationHashError, UnreviewedMigrationError } from './errors'
import type { MigrationAdapter, MigrationRow } from './adapter'

export interface RunnerOptions {
  adapter: MigrationAdapter
  migrationsDir: string
  /** When true, refuse to apply migrations whose meta.json.reviewed is false. Defaults to true outside dev. */
  requireReviewed?: boolean
  /** Owner string written into the lock table. */
  owner?: string
}

export interface AppliedSummary {
  applied: string[]
  batch: number | null
}

export async function migrateLatest(opts: RunnerOptions): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()
  await opts.adapter.applySqlInTx(migrationsTableDdl(opts.adapter.dialect))
  await opts.adapter.applySqlInTx(lockTableDdl(opts.adapter.dialect))

  const owner = opts.owner ?? `${process.pid}@${new Date().toISOString()}`
  const got = await opts.adapter.acquireLock(owner)
  if (!got) {
    throw new MigrationLockError('Another process holds the migration lock')
  }
  try {
    const journal = await readJournal(opts.migrationsDir, opts.adapter.dialect)
    const applied = await opts.adapter.listApplied()
    const appliedIds = new Set(applied.map((r) => r.id))

    const pending = journal.entries.filter((e) => !appliedIds.has(e.id))
    if (pending.length === 0) {
      return { applied: [], batch: null }
    }

    // Verify each pending migration's hash + reviewed marker before any apply.
    for (const entry of pending) {
      const dir = path.join(opts.migrationsDir, entry.id)
      const actualHash = await computeMigrationHash(dir)
      if (actualHash !== entry.hash) {
        throw new MigrationHashError(entry.id, entry.expected ?? entry.hash, actualHash)
      }
      if (opts.requireReviewed ?? process.env.NODE_ENV !== 'development') {
        const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
        if (meta.reviewed !== true) {
          throw new UnreviewedMigrationError(entry.id)
        }
      }
    }

    const nextBatch = (applied.length === 0 ? 0 : Math.max(...applied.map((r) => r.batch))) + 1
    const ids: string[] = []

    for (const entry of pending) {
      const dir = path.join(opts.migrationsDir, entry.id)
      const upSql = await readFile(path.join(dir, 'up.sql'), 'utf8')
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
      const useTx = meta.transaction !== false
      if (useTx) {
        await opts.adapter.applySqlInTx(upSql)
      } else {
        await opts.adapter.applySqlNoTx(upSql)
      }
      await opts.adapter.recordApplied({
        id: entry.id,
        name: entry.tag,
        hash: entry.hash,
        batch: nextBatch,
        direction: 'up',
      })
      ids.push(entry.id)
    }

    return { applied: ids, batch: nextBatch }
  } finally {
    await opts.adapter.releaseLock()
  }
}
```

- [x] **Step 9.2: Test using MemoryMigrationAdapter + a temp migrations dir**

```ts
// packages/db/__tests__/unit/runner-latest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  migrateLatest,
  MemoryMigrationAdapter,
  computeMigrationHash,
  appendJournalEntry,
  MigrationLockError,
} from '@forinda/kickjs-db'

let dir: string

async function seedMigration(dir: string, id: string, name: string, reviewed = true) {
  const mig = path.join(dir, id)
  await mkdir(mig, { recursive: true })
  await writeFile(
    path.join(mig, 'up.sql'),
    `-- REVIEWED: ${reviewed}\nCREATE TABLE "${id}_t" ();`,
    'utf8',
  )
  await writeFile(
    path.join(mig, 'down.sql'),
    `-- REVIEWED: ${reviewed}\nDROP TABLE "${id}_t";`,
    'utf8',
  )
  await writeFile(path.join(mig, 'snapshot.json'), '{"v":1}', 'utf8')
  await writeFile(
    path.join(mig, 'meta.json'),
    JSON.stringify({
      id,
      name,
      reviewed,
      dialect: 'postgres',
    }),
    'utf8',
  )
  const hash = await computeMigrationHash(mig)
  await appendJournalEntry(dir, 'postgres', {
    id,
    tag: name,
    hash,
    createdAt: new Date().toISOString(),
  })
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-runner-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('migrateLatest', () => {
  it('applies all pending migrations in one batch', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.applied).toEqual(['20260427_010000_a', '20260427_020000_b'])
    expect(r.batch).toBe(1)
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(2)
    expect(applied.every((r) => r.batch === 1)).toBe(true)
  })

  it('does nothing when there are no pending', async () => {
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.applied).toEqual([])
    expect(r.batch).toBe(null)
  })

  it('throws MigrationLockError when the lock is held', async () => {
    const adapter = new MemoryMigrationAdapter()
    expect(await adapter.acquireLock('other')).toBe(true)
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }),
    ).rejects.toBeInstanceOf(MigrationLockError)
  })

  it('refuses unreviewed migration in non-dev', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a', /* reviewed */ false)
    const adapter = new MemoryMigrationAdapter()
    await expect(
      migrateLatest({ adapter, migrationsDir: dir, owner: 'test', requireReviewed: true }),
    ).rejects.toThrow(/unreviewed/i)
  })
})
```

- [x] **Step 9.3: Re-export, run, commit**

```bash
git commit -m "feat(db): migrateLatest runner — lock + batch + hash verify + reviewed enforcement (M1-S5)"
```

---

## Task 10: Runner — `migrate up` (single)

**Story:** M1-S5.
**Files:** Modify `packages/db/src/migrate/runner.ts`, create `packages/db/__tests__/unit/runner-up-down.test.ts`.

`migrate up` applies the next single pending migration (vs `migrateLatest` which applies all). Same batch semantics — uses the next batch number even for one migration.

- [x] **Step 10.1: Implement**

```ts
// In runner.ts — add alongside migrateLatest
export async function migrateUp(opts: RunnerOptions): Promise<AppliedSummary> {
  // Same flow as migrateLatest but limits to the first pending entry.
  // ... refactor: extract a private applyPending(entries) helper used by both.
}
```

Refactor: move the body of `migrateLatest` into a private function `runForward(opts, entries)` that takes a pre-filtered list of entries. Then:

- `migrateLatest` filters all pending and calls `runForward`.
- `migrateUp` filters pending and slices off the first entry, calling `runForward` with that single-element array.

- [x] **Step 10.2: Test**

```ts
// In runner-up-down.test.ts (new file)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// ... same seedMigration helper as Task 9 (extract to a fixtures file used by both)

describe('migrateUp', () => {
  it('applies only the next pending', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    const r = await migrateUp({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.applied).toEqual(['20260427_010000_a'])
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(1)
  })
})
```

Extract a shared fixture file: `packages/db/__tests__/fixtures/seed-migration.ts` with the `seedMigration` helper. Update Task 9's test to import from there.

- [x] **Step 10.3: Run + commit**

```bash
git commit -m "feat(db): migrateUp runner — apply single next pending (M1-S5)"
```

---

## Task 11: Runner — `migrate down` (single reverse)

**Story:** M1-S5.

`migrate down` reverses the most recent applied entry. Reads `down.sql` from the migration dir, applies it, removes the row from `kick_migrations`.

- [x] **Step 11.1: Implement**

```ts
// In runner.ts
export async function migrateDown(opts: RunnerOptions): Promise<{ reversed: string | null }> {
  await opts.adapter.ensureMigrationTables()
  const owner = opts.owner ?? `${process.pid}@${new Date().toISOString()}`
  const got = await opts.adapter.acquireLock(owner)
  if (!got) throw new MigrationLockError('Another process holds the migration lock')
  try {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: null }
    // Sort by batch then appliedAt so 'most recent' is unambiguous.
    const sorted = [...applied].sort((a, b) =>
      a.batch !== b.batch ? a.batch - b.batch : a.appliedAt.localeCompare(b.appliedAt),
    )
    const last = sorted[sorted.length - 1]
    const dir = path.join(opts.migrationsDir, last.id)
    const downSql = await readFile(path.join(dir, 'down.sql'), 'utf8')
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
    if (opts.requireReviewed ?? process.env.NODE_ENV !== 'development') {
      if (meta.reviewed !== true) throw new UnreviewedMigrationError(last.id)
    }
    const useTx = meta.transaction !== false
    if (useTx) await opts.adapter.applySqlInTx(downSql)
    else await opts.adapter.applySqlNoTx(downSql)
    await opts.adapter.removeApplied(last.id)
    return { reversed: last.id }
  } finally {
    await opts.adapter.releaseLock()
  }
}
```

- [x] **Step 11.2: Test (extend `runner-up-down.test.ts`)**

```ts
describe('migrateDown', () => {
  it('reverses the most recent applied', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    const r = await migrateDown({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.reversed).toBe('20260427_020000_b')
    const applied = await adapter.listApplied()
    expect(applied.map((a) => a.id)).toEqual(['20260427_010000_a'])
  })

  it('returns null when nothing applied', async () => {
    const adapter = new MemoryMigrationAdapter()
    expect((await migrateDown({ adapter, migrationsDir: dir, owner: 'test' })).reversed).toBe(null)
  })
})
```

- [x] **Step 11.3: Commit**

```bash
git commit -m "feat(db): migrateDown runner — reverse most recent (M1-S5)"
```

---

## Task 12: Runner — `migrate rollback` (whole batch)

**Story:** M1-S5.

Reverses every migration in the most recent batch as a single unit. Same lock + reviewed checks. Order: reverse-applied order (so a batch of [a, b, c] tears down c, b, a).

- [x] **Step 12.1: Implement**

```ts
// In runner.ts
export async function migrateRollback(opts: RunnerOptions): Promise<{ reversed: string[] }> {
  await opts.adapter.ensureMigrationTables()
  const owner = opts.owner ?? `${process.pid}@${new Date().toISOString()}`
  const got = await opts.adapter.acquireLock(owner)
  if (!got) throw new MigrationLockError('Another process holds the migration lock')
  try {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: [] }
    const lastBatch = Math.max(...applied.map((r) => r.batch))
    const targets = applied.filter((r) => r.batch === lastBatch).reverse()
    const reversed: string[] = []
    for (const row of targets) {
      const dir = path.join(opts.migrationsDir, row.id)
      const downSql = await readFile(path.join(dir, 'down.sql'), 'utf8')
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
      if (opts.requireReviewed ?? process.env.NODE_ENV !== 'development') {
        if (meta.reviewed !== true) throw new UnreviewedMigrationError(row.id)
      }
      const useTx = meta.transaction !== false
      if (useTx) await opts.adapter.applySqlInTx(downSql)
      else await opts.adapter.applySqlNoTx(downSql)
      await opts.adapter.removeApplied(row.id)
      reversed.push(row.id)
    }
    return { reversed }
  } finally {
    await opts.adapter.releaseLock()
  }
}
```

- [x] **Step 12.2: Test**

```ts
// packages/db/__tests__/unit/runner-rollback.test.ts
describe('migrateRollback', () => {
  it('reverses the entire last batch in reverse order', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 1

    await seedMigration(dir, '20260427_030000_c', 'c')
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' }) // batch 2

    const r = await migrateRollback({ adapter, migrationsDir: dir, owner: 'test' })
    expect(r.reversed).toEqual(['20260427_030000_c']) // batch 2 had only c
    const applied = await adapter.listApplied()
    expect(applied.map((a) => a.id)).toEqual(['20260427_010000_a', '20260427_020000_b'])
  })
})
```

- [x] **Step 12.3: Commit**

```bash
git commit -m "feat(db): migrateRollback runner — reverse entire last batch (M1-S5)"
```

---

## Task 13: Runner — `migrate status`

**Story:** M1-S5.

Returns a structured summary of all journal entries — applied vs pending, batch numbers, hashes — for the CLI to render and for tests to assert.

- [x] **Step 13.1: Implement**

```ts
// In runner.ts
export interface StatusEntry {
  id: string
  tag: string
  hash: string
  state: 'applied' | 'pending'
  batch: number | null
  appliedAt: string | null
  reviewed: boolean
}

export async function migrateStatus(
  opts: Pick<RunnerOptions, 'adapter' | 'migrationsDir'>,
): Promise<StatusEntry[]> {
  await opts.adapter.ensureMigrationTables()
  const journal = await readJournal(opts.migrationsDir, opts.adapter.dialect)
  const applied = await opts.adapter.listApplied()
  const byId = new Map(applied.map((r) => [r.id, r]))
  return Promise.all(
    journal.entries.map(async (e) => {
      const row = byId.get(e.id)
      const meta = JSON.parse(
        await readFile(path.join(opts.migrationsDir, e.id, 'meta.json'), 'utf8'),
      )
      return {
        id: e.id,
        tag: e.tag,
        hash: e.hash,
        state: row ? 'applied' : 'pending',
        batch: row?.batch ?? null,
        appliedAt: row?.appliedAt ?? null,
        reviewed: meta.reviewed === true,
      }
    }),
  )
}
```

- [x] **Step 13.2: Test + commit**

```ts
// packages/db/__tests__/unit/runner-status.test.ts
describe('migrateStatus', () => {
  it('reports applied + pending with batch numbers', async () => {
    await seedMigration(dir, '20260427_010000_a', 'a')
    await seedMigration(dir, '20260427_020000_b', 'b')
    const adapter = new MemoryMigrationAdapter()
    await migrateLatest({ adapter, migrationsDir: dir, owner: 'test' })

    await seedMigration(dir, '20260427_030000_c', 'c')

    const status = await migrateStatus({ adapter, migrationsDir: dir })
    expect(status.map((s) => ({ id: s.id, state: s.state, batch: s.batch }))).toEqual([
      { id: '20260427_010000_a', state: 'applied', batch: 1 },
      { id: '20260427_020000_b', state: 'applied', batch: 1 },
      { id: '20260427_030000_c', state: 'pending', batch: null },
    ])
  })
})
```

```bash
git commit -m "feat(db): migrateStatus runner — applied/pending summary (M1-S5)"
```

---

## Task 14: PG schema introspection (`information_schema`)

**Story:** M1-S6 (drift) + M1-S10 (introspect command).
**Files:**

- Create: `packages/db/src/migrate/introspect-pg.ts`
- Create: `packages/db/src/migrate/introspect-types.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/integration/introspect-pg.test.ts`

The introspector reads `information_schema.tables/columns/key_column_usage` + `pg_indexes` + `pg_constraint` and emits the canonical `SchemaSnapshot` IR — same shape that `extractSnapshot()` produces from the DSL. One IR, two producers.

- [x] **Step 14.1: Define the runner interface (driver-agnostic)**

Create `packages/db/src/migrate/introspect-types.ts`:

```ts
/**
 * Driver-agnostic SQL runner. Both pg.Client and pg.Pool match this shape via
 * structural typing. Lets introspectPg() stay portable across pg / pg-pool /
 * @neondatabase/serverless without importing 'pg' from the core package.
 */
export interface PgQueryRunner {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }>
}

export interface IntrospectPgOptions {
  /** Default 'public'. */
  schema?: string
  /** Migration tracking tables to skip. Default ['kick_migrations', 'kick_migrations_lock']. */
  excludeTables?: readonly string[]
}
```

- [x] **Step 14.2: Write the failing integration test**

Create `packages/db/__tests__/integration/introspect-pg.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { introspectPg } from '@forinda/kickjs-db'

let container: StartedPostgreSqlContainer
let client: pg.Client

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  client = new pg.Client({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  await client.connect()
}, 90_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

describe('introspectPg()', () => {
  it('extracts the canonical SchemaSnapshot for a 2-table schema with FK + indexes', async () => {
    await client.query(`
      CREATE TABLE "users" (
        "id" serial NOT NULL,
        "email" varchar(255) NOT NULL,
        "name" varchar(120),
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        PRIMARY KEY ("id")
      );
      CREATE TABLE "posts" (
        "id" serial NOT NULL,
        "author_id" integer NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        PRIMARY KEY ("id")
      );
      CREATE INDEX "users_email_idx" ON "users" ("email");
      CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
      CREATE UNIQUE INDEX "posts_title_author_unique" ON "posts" ("title", "author_id");
      ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk"
        FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `)

    const snap = await introspectPg(client)

    expect(snap.version).toBe(1)
    expect(snap.dialect).toBe('postgres')
    expect(Object.keys(snap.tables).sort()).toEqual(['posts', 'users'])

    expect(snap.tables.users.columns.id).toEqual({
      name: 'id',
      type: 'serial',
      nullable: false,
      default: null,
      primaryKey: true,
    })
    expect(snap.tables.users.columns.email).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    })
    expect(snap.tables.users.columns.created_at).toMatchObject({
      type: 'timestamptz',
      default: 'CURRENT_TIMESTAMP',
    })
    expect(snap.tables.users.columns.is_active).toMatchObject({
      type: 'boolean',
      default: 'true',
    })

    // Indexes — the PK-backing index is excluded; user-defined ones are kept.
    expect(snap.tables.users.indexes.map((i) => i.name).sort()).toEqual([
      'users_email_idx',
      'users_email_unique',
    ])
    const unique = snap.tables.users.indexes.find((i) => i.name === 'users_email_unique')
    expect(unique?.unique).toBe(true)
    expect(unique?.columns).toEqual(['email'])

    // Multi-column unique on posts
    const multiUnique = snap.tables.posts.indexes.find(
      (i) => i.name === 'posts_title_author_unique',
    )
    expect(multiUnique?.unique).toBe(true)
    expect(multiUnique?.columns).toEqual(['title', 'author_id'])

    // FK
    expect(snap.tables.posts.foreignKeys).toEqual([
      {
        name: 'posts_author_fk',
        columns: ['author_id'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no_action',
      },
    ])
  }, 60_000)

  it('skips kick_migrations + kick_migrations_lock tables', async () => {
    await client.query(`
      CREATE TABLE "kick_migrations" ("id" varchar(128) PRIMARY KEY);
      CREATE TABLE "kick_migrations_lock" ("id" smallint PRIMARY KEY);
    `)
    const snap = await introspectPg(client)
    expect(snap.tables.kick_migrations).toBeUndefined()
    expect(snap.tables.kick_migrations_lock).toBeUndefined()
  }, 60_000)
})
```

- [x] **Step 14.3: Run — fails (no `introspectPg` export yet)**

```bash
pnpm --filter @forinda/kickjs-db test
```

- [x] **Step 14.4: Implement `introspectPg()` — orchestrator**

Create `packages/db/src/migrate/introspect-pg.ts`:

```ts
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  FkAction,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import type { IntrospectPgOptions, PgQueryRunner } from './introspect-types'

const DEFAULT_EXCLUDED = ['kick_migrations', 'kick_migrations_lock']

export async function introspectPg(
  client: PgQueryRunner,
  opts: IntrospectPgOptions = {},
): Promise<SchemaSnapshot> {
  const schema = opts.schema ?? 'public'
  const excluded = opts.excludeTables ?? DEFAULT_EXCLUDED

  const tableRows = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  )

  const tables: Record<string, TableSnapshot> = {}
  for (const t of tableRows.rows) {
    if (excluded.includes(t.table_name)) continue
    tables[t.table_name] = {
      name: t.table_name,
      columns: await readColumns(client, schema, t.table_name),
      indexes: await readIndexes(client, schema, t.table_name),
      foreignKeys: await readForeignKeys(client, schema, t.table_name),
      checks: [],
    }
  }
  return { version: 1, dialect: 'postgres', tables }
}
```

- [x] **Step 14.5: Implement `readColumns()` — types + nullability + defaults + primary key flag**

Append to the same file:

```ts
interface ColumnRow {
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
}

async function readColumns(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<TableSnapshot['columns']> {
  const cols = await client.query<ColumnRow>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default,
            character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  )

  const pkCols = await client.query<{ column_name: string }>(
    `SELECT k.column_name
     FROM information_schema.table_constraints c
     JOIN information_schema.key_column_usage k
       ON k.constraint_name = c.constraint_name
      AND k.table_schema = c.table_schema
     WHERE c.table_schema = $1 AND c.table_name = $2 AND c.constraint_type = 'PRIMARY KEY'
     ORDER BY k.ordinal_position`,
    [schema, table],
  )
  const pkSet = new Set(pkCols.rows.map((r) => r.column_name))

  const out: TableSnapshot['columns'] = {}
  for (const r of cols.rows) {
    const isSerial = isSerialColumn(r)
    out[r.column_name] = {
      name: r.column_name,
      type: isSerial ? serialTypeFor(r) : normalizeType(r),
      nullable: r.is_nullable === 'YES',
      // serial columns own their nextval default; collapse it.
      default: isSerial ? null : normalizeDefault(r.column_default),
      primaryKey: pkSet.has(r.column_name),
    }
  }
  return out
}

function isSerialColumn(r: ColumnRow): boolean {
  // serial = integer (or bigint/smallint) with a nextval(...) default.
  if (!r.column_default) return false
  if (!/^nextval\(/.test(r.column_default)) return false
  return r.udt_name === 'int2' || r.udt_name === 'int4' || r.udt_name === 'int8'
}

function serialTypeFor(r: ColumnRow): string {
  if (r.udt_name === 'int8') return 'bigserial'
  if (r.udt_name === 'int2') return 'smallserial'
  return 'serial'
}

function normalizeType(r: ColumnRow): string {
  // Map PG's information_schema data_type back to the DSL surface.
  if (r.data_type === 'character varying') {
    return r.character_maximum_length ? `varchar(${r.character_maximum_length})` : 'varchar'
  }
  if (r.data_type === 'character') {
    return r.character_maximum_length ? `char(${r.character_maximum_length})` : 'char(1)'
  }
  if (r.data_type === 'numeric') {
    if (r.numeric_precision !== null && r.numeric_scale !== null) {
      return `numeric(${r.numeric_precision}, ${r.numeric_scale})`
    }
    if (r.numeric_precision !== null) return `numeric(${r.numeric_precision})`
    return 'numeric'
  }
  if (r.data_type === 'timestamp with time zone') return 'timestamptz'
  if (r.data_type === 'timestamp without time zone') return 'timestamp'
  if (r.data_type === 'time without time zone') return 'time'
  if (r.data_type === 'double precision') return 'double precision'
  if (r.data_type === 'USER-DEFINED') return r.udt_name
  if (r.data_type === 'ARRAY') {
    // udt_name for arrays is _<element>; strip and append [].
    const elem = r.udt_name.replace(/^_/, '')
    return `${elem}[]`
  }
  // bigint, integer, smallint, text, boolean, date, json, jsonb, bytea, uuid,
  // interval — pass through as data_type when it matches the DSL.
  return r.data_type
}

function normalizeDefault(raw: string | null): string | null {
  if (!raw) return null
  // Strip PG's :: cast suffixes: 'true'::boolean → true, 'foo'::text → 'foo'
  const stripped = raw.replace(/::[\w" ]+(\([^)]*\))?$/, '')
  // Normalize CURRENT_TIMESTAMP / now() to the DSL canonical token.
  const upper = stripped.toUpperCase()
  if (upper === 'NOW()' || upper === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP'
  if (upper === 'GEN_RANDOM_UUID()') return 'gen_random_uuid()'
  // 'foo' literal → foo. true / false / numeric pass through.
  return stripped.replace(/^'(.*)'$/, '$1')
}
```

- [x] **Step 14.6: Implement `readIndexes()` — exclude PK-backing index**

Still in the same file:

```ts
interface IndexRow {
  index_name: string
  column_name: string
  ordinal_position: number
  is_unique: boolean
  is_primary: boolean
}

async function readIndexes(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<IndexSnapshot[]> {
  const rows = await client.query<IndexRow>(
    `SELECT i.relname AS index_name,
            a.attname AS column_name,
            a.attnum AS ordinal_position,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary
     FROM pg_class t
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN pg_index ix ON ix.indrelid = t.oid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = $1 AND t.relname = $2 AND t.relkind = 'r'
     ORDER BY i.relname, k.ord`,
    [schema, table],
  )

  // Group rows by index_name, preserve column order.
  const byIndex = new Map<string, IndexSnapshot & { _isPrimary: boolean }>()
  for (const r of rows.rows) {
    let entry = byIndex.get(r.index_name)
    if (!entry) {
      entry = {
        name: r.index_name,
        columns: [],
        unique: r.is_unique,
        _isPrimary: r.is_primary,
      }
      byIndex.set(r.index_name, entry)
    }
    entry.columns.push(r.column_name)
  }

  // Drop PK-backing indexes — primaryKey is recorded on the column itself.
  return [...byIndex.values()]
    .filter((i) => !i._isPrimary)
    .map(({ _isPrimary, ...rest }) => rest)
    .sort((a, b) => a.name.localeCompare(b.name))
}
```

- [x] **Step 14.7: Implement `readForeignKeys()`**

Still in the same file:

```ts
interface FkRow {
  constraint_name: string
  column_name: string
  ordinal_position: number
  ref_table: string
  ref_column: string
  delete_rule: string
  update_rule: string
}

async function readForeignKeys(
  client: PgQueryRunner,
  schema: string,
  table: string,
): Promise<ForeignKeySnapshot[]> {
  const rows = await client.query<FkRow>(
    `SELECT tc.constraint_name,
            kcu.column_name,
            kcu.ordinal_position,
            ccu.table_name AS ref_table,
            ccu.column_name AS ref_column,
            rc.delete_rule,
            rc.update_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = rc.unique_constraint_name
      AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schema, table],
  )

  const byName = new Map<string, ForeignKeySnapshot>()
  for (const r of rows.rows) {
    let fk = byName.get(r.constraint_name)
    if (!fk) {
      fk = {
        name: r.constraint_name,
        columns: [],
        refTable: r.ref_table,
        refColumns: [],
        onDelete: mapFkAction(r.delete_rule),
        onUpdate: mapFkAction(r.update_rule),
      }
      byName.set(r.constraint_name, fk)
    }
    fk.columns.push(r.column_name)
    fk.refColumns.push(r.ref_column)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function mapFkAction(raw: string): FkAction {
  switch (raw.toUpperCase()) {
    case 'CASCADE':
      return 'cascade'
    case 'RESTRICT':
      return 'restrict'
    case 'SET NULL':
      return 'set_null'
    case 'SET DEFAULT':
      return 'set_default'
    case 'NO ACTION':
    default:
      return 'no_action'
  }
}
```

- [x] **Step 14.8: Re-export from package barrel**

Add to `packages/db/src/index.ts`:

```ts
export { introspectPg } from './migrate/introspect-pg'
export type { IntrospectPgOptions, PgQueryRunner } from './migrate/introspect-types'
```

- [x] **Step 14.9: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: integration test passes (~30s for container start + ~3s test). All other tests stay green.

- [x] **Step 14.10: Format + commit**

```bash
pnpm prettier --write packages/db/src/migrate/introspect-pg.ts packages/db/src/migrate/introspect-types.ts packages/db/__tests__/integration/introspect-pg.test.ts packages/db/src/index.ts
git add packages/db/src/migrate/introspect-pg.ts packages/db/src/migrate/introspect-types.ts packages/db/__tests__/integration/introspect-pg.test.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): introspectPg() — SchemaSnapshot from a live PG database (M1-S6, M1-S10)

PgQueryRunner is a structural interface — pg.Client / pg.Pool match it
without the core package importing 'pg'. Three readers (columns, indexes,
foreign keys) emit the same canonical IR the diff engine consumes, so
the next migration generated against introspected state is precise.

Serial detection collapses (integer + nextval(...) default) → 'serial'
so the round-trip generated → applied → introspected stays stable.
PK-backing indexes are excluded (primaryKey lives on the column).
EOF
)"
```

---

## Task 15: Drift detection — compare introspection to last applied snapshot

**Story:** M1-S6.
**Files:**

- Create: `packages/db/src/migrate/drift.ts`
- Modify: `packages/db/src/migrate/runner.ts` — call drift check at the start of `migrateLatest`/`migrateUp`
- Create: `packages/db/__tests__/unit/drift.test.ts`

```ts
// packages/db/src/migrate/drift.ts
import { diff } from '../diff/engine'
import type { SchemaSnapshot } from '../snapshot/types'
import { MigrationDriftError, type SchemaDiffSummary } from './errors'
import type { Change } from '../diff/types'

export type DriftBehavior = 'error' | 'warn' | 'ignore'

export async function checkDrift(
  liveSnapshot: SchemaSnapshot,
  expectedSnapshot: SchemaSnapshot,
  behavior: DriftBehavior,
  log: { warn: (msg: string) => void } = console,
): Promise<void> {
  const changes = diff(expectedSnapshot, liveSnapshot)
  if (changes.length === 0) return
  if (behavior === 'ignore') return

  const summary = summarize(changes)
  const message = `Schema drift detected: ${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed`
  if (behavior === 'warn') {
    log.warn(message)
    return
  }
  throw new MigrationDriftError(message, summary)
}

function summarize(changes: Change[]): SchemaDiffSummary {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const c of changes) {
    if (c.kind === 'createTable') added.push(c.table.name)
    else if (c.kind === 'dropTable') removed.push(c.table.name)
    else if (c.kind === 'addColumn') added.push(`${c.table}.${c.column.name}`)
    else if (c.kind === 'dropColumn') removed.push(`${c.table}.${c.column.name}`)
    else if (c.kind === 'alterColumn') changed.push(`${c.table}.${c.column}`)
    else if (c.kind === 'renameColumn') changed.push(`${c.table}.${c.from}→${c.to}`)
    else if (c.kind === 'renameTable') changed.push(`${c.from}→${c.to}`)
    else if (c.kind === 'addIndex') added.push(`${c.table}#${c.index.name}`)
    else if (c.kind === 'dropIndex') removed.push(`${c.table}#${c.index.name}`)
    else if (c.kind === 'addForeignKey') added.push(`${c.table}!${c.fk.name}`)
    else if (c.kind === 'dropForeignKey') removed.push(`${c.table}!${c.fk.name}`)
  }
  return { added, removed, changed }
}
```

Wire into `migrateLatest`:

```ts
// runner.ts — after acquireLock, before applying:
if (opts.driftCheck && opts.driftCheck !== 'ignore' && applied.length > 0) {
  const lastAppliedId = applied[applied.length - 1].id
  const expectedSnap = JSON.parse(
    await readFile(path.join(opts.migrationsDir, lastAppliedId, 'snapshot.json'), 'utf8'),
  )
  const liveSnap = await opts.adapter.introspect()
  await checkDrift(liveSnap, expectedSnap, opts.driftCheck)
}
```

Add `driftCheck?: DriftBehavior` to `RunnerOptions` (default `'error'`).

Test with `MemoryMigrationAdapter.__setIntrospectedSchema(...)` to stage drift fixtures.

```ts
// drift.test.ts
describe('checkDrift', () => {
  it('passes when live matches expected', async () => {
    await expect(checkDrift(empty, empty, 'error')).resolves.toBeUndefined()
  })

  it('throws MigrationDriftError on added table', async () => {
    const live: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        manual_table: {
          name: 'manual_table',
          columns: {
            id: { name: 'id', type: 'integer', nullable: false, default: null, primaryKey: true },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    await expect(checkDrift(live, empty, 'error')).rejects.toBeInstanceOf(MigrationDriftError)
  })

  it("warn just logs, doesn't throw", async () => {
    const warn = vi.fn()
    await checkDrift(live, empty, 'warn', { warn })
    expect(warn).toHaveBeenCalled()
  })
})
```

```bash
git commit -m "feat(db): drift detection via diff(live, expected) (M1-S6)"
```

---

## Task 16: `kickDbAdapter()` via `defineAdapter()` (KickJS DI integration)

**Story:** M1-S7.
**Files:**

- Create: `packages/db/src/adapter.ts`
- Create: `packages/db/__tests__/unit/adapter.test.ts`
- Modify: `packages/db/src/index.ts`

The plugin shape uses `defineAdapter` per memory rule. It takes a `MigrationAdapter` (provided by `db-pg` in Task 19) plus runner config, registers under DI, runs migrationsOnBoot policy, exposes introspect/devtoolsTabs.

- [x] **Step 16.1: Implement**

```ts
// packages/db/src/adapter.ts
import { defineAdapter } from '@forinda/kickjs'
import { migrateLatest, migrateStatus } from './migrate/runner'
import type { MigrationAdapter } from './migrate/adapter'
import type { DriftBehavior } from './migrate/drift'

export type MigrationsOnBoot = 'fail-if-pending' | 'apply' | 'ignore'

export interface KickDbAdapterOptions {
  migrationAdapter: MigrationAdapter
  migrationsDir: string
  /** Default 'fail-if-pending'. */
  migrationsOnBoot?: MigrationsOnBoot
  /** Default 'error' outside dev. */
  driftCheck?: DriftBehavior
  /** Default true outside dev. */
  requireReviewed?: boolean
  /** Optional DI token to register under. */
  token?: import('@forinda/kickjs').Token<unknown>
}

export const kickDbAdapter = (opts: KickDbAdapterOptions) =>
  defineAdapter({
    name: 'kickjs-db',
    async beforeStart({ container, logger }) {
      const policy = opts.migrationsOnBoot ?? 'fail-if-pending'
      const status = await migrateStatus({
        adapter: opts.migrationAdapter,
        migrationsDir: opts.migrationsDir,
      })
      const pending = status.filter((s) => s.state === 'pending')
      if (pending.length > 0) {
        if (policy === 'fail-if-pending') {
          throw new Error(
            `KickDb: ${pending.length} pending migration(s); apply with kick db migrate latest before boot`,
          )
        }
        if (policy === 'apply') {
          logger.info(`KickDb applying ${pending.length} pending migration(s) on boot`)
          await migrateLatest({
            adapter: opts.migrationAdapter,
            migrationsDir: opts.migrationsDir,
            requireReviewed: opts.requireReviewed,
            driftCheck: opts.driftCheck,
          })
        }
      }
      // Register the migration adapter under the optional token so adopters
      // can inject it for ad-hoc tooling. The KickDbClient (Task 19) registers
      // separately under DB_PRIMARY.
      if (opts.token) container.register(opts.token, opts.migrationAdapter)
    },
    async shutdown() {
      await opts.migrationAdapter.close()
    },
    async introspect() {
      return {
        dialect: opts.migrationAdapter.dialect,
        migrationsDir: opts.migrationsDir,
        migrationsOnBoot: opts.migrationsOnBoot ?? 'fail-if-pending',
      }
    },
  })
```

- [x] **Step 16.2: Test using a stub migrationAdapter + Container.create()**

```ts
// adapter.test.ts
import { describe, it, expect } from 'vitest'
import { Container } from '@forinda/kickjs'
import { kickDbAdapter, MemoryMigrationAdapter } from '@forinda/kickjs-db'

describe('kickDbAdapter', () => {
  it('passes through when no pending migrations under fail-if-pending', async () => {
    const container = Container.create()
    const ad = kickDbAdapter({
      migrationAdapter: new MemoryMigrationAdapter(),
      migrationsDir: '/tmp/empty',
    })
    await expect(ad.beforeStart({ container, logger: console as any })).resolves.toBeUndefined()
  })

  it('throws when pending under fail-if-pending', async () => {
    /* seed dir with one pending entry, expect throw */
  })

  it('applies pending under "apply" policy', async () => {
    /* seed + verify adapter.listApplied */
  })
})
```

- [x] **Step 16.3: Re-export, run, commit**

```bash
git commit -m "feat(db): kickDbAdapter() via defineAdapter — boot policy + lifecycle (M1-S7)"
```

---

## Task 17: Boot policies — fail-if-pending / apply / ignore (integration test)

**Story:** M1-S7.

Integration test extension of Task 16 that exercises each boot policy end-to-end against a real Postgres container. Lands in `packages/db/__tests__/integration/boot-policy.test.ts`.

- [x] **Step 17.1: Test scaffold**

```ts
// boot-policy.test.ts (sketch)
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
}, 90_000)
afterAll(async () => {
  await container?.stop()
})

it(
  'fail-if-pending throws when pending exist' /* uses pgAdapter from db-pg — needs Task 19 first */,
)
```

This test is **deferred to land alongside Task 19** since it requires a real `pgAdapter`. Mark this task's tests as `it.skip()` for now and complete in Task 19.

- [x] **Step 17.2: Stub commit (skip-marker tests)**

```bash
git commit -m "test(db): boot-policy integration scaffold — completed alongside Task 19 (M1-S7)"
```

---

## Task 18: DI tokens — `DB_PRIMARY`, `DB_REPLICA`

**Story:** M1-S9.
**Files:**

- Create: `packages/db/src/tokens.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/di-tokens.test.ts`

```ts
// packages/db/src/tokens.ts
import { createToken } from '@forinda/kickjs'
import type { KickDbClient } from './client/types'

export const DB_PRIMARY = createToken<KickDbClient>('app/db/primary')
export const DB_REPLICA = createToken<KickDbClient>('app/db/replica')
export const DB_CLIENT = DB_PRIMARY
```

(Forward reference to `KickDbClient` from Task 19 — resolves once Task 19 lands.)

- [x] **Step 18.1: Test that the tokens exist + are unique**

```ts
import { describe, it, expect } from 'vitest'
import { DB_PRIMARY, DB_REPLICA, DB_CLIENT } from '@forinda/kickjs-db'

describe('DI tokens', () => {
  it('DB_PRIMARY uses the slash-delimited convention', () => {
    expect(DB_PRIMARY.toString()).toBe('app/db/primary')
  })
  it('DB_CLIENT aliases DB_PRIMARY', () => {
    expect(DB_CLIENT).toBe(DB_PRIMARY)
  })
  it('DB_PRIMARY and DB_REPLICA are distinct', () => {
    expect(DB_PRIMARY).not.toBe(DB_REPLICA)
  })
})
```

- [x] **Step 18.2: Commit**

```bash
git commit -m "feat(db): export DB_PRIMARY/DB_REPLICA/DB_CLIENT DI tokens (M1-S9)"
```

---

## Task 19: `KickDbClient` over Kysely + `db-pg` adapter package

**Story:** M1-S8 (also closes the deferred Task 17 boot-policy integration test).

Largest task in M1. Three logical pieces — each their own commit:

1. **19a:** bootstrap `packages/db-pg/` package shell + ship `pgAdapter` (a `MigrationAdapter` impl).
2. **19b:** `KickDbClient` wrapper around Kysely with events / transaction / savepoint.
3. **19c:** wire the deferred boot-policy integration test from Task 17.

**Files (all 19a-c combined):**

- Create: `packages/db-pg/{package.json,tsconfig.json,tsconfig.test.json,tsdown.config.ts,vitest.config.ts,LICENSE,README.md,src/index.ts,src/adapter.ts}`
- Create: `packages/db-pg/__tests__/integration/adapter.test.ts`
- Create: `packages/db-pg/__tests__/integration/boot-policy.test.ts`
- Create: `packages/db/src/client/{types.ts,create.ts,events.ts,schema-types.ts}`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/client-events.test.ts`

---

### Task 19a: Bootstrap `packages/db-pg/` and ship `pgAdapter`

- [x] **Step 19a.1: Create `packages/db-pg/package.json`**

```json
{
  "name": "@forinda/kickjs-db-pg",
  "version": "5.0.2",
  "private": true,
  "description": "node-postgres adapter for @forinda/kickjs-db — MigrationAdapter + Kysely PostgresDialect",
  "keywords": ["kickjs", "postgres", "pg", "@forinda/kickjs-db"],
  "type": "module",
  "main": "dist/index.mjs",
  "types": "dist/index.d.mts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "types": "./dist/index.d.mts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "wireit",
    "dev": "tsdown --watch",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .wireit",
    "lint": "tsc --noEmit"
  },
  "wireit": {
    "build": {
      "command": "tsdown",
      "files": ["src/**/*.ts", "tsdown.config.ts", "tsconfig.json", "package.json"],
      "output": ["dist/**"],
      "dependencies": []
    }
  },
  "dependencies": {},
  "peerDependencies": {
    "@forinda/kickjs-db": "workspace:*",
    "kysely": ">=0.27.0 <1.0.0",
    "pg": ">=8.11.0"
  },
  "devDependencies": {
    "@forinda/kickjs-db": "workspace:*",
    "@testcontainers/postgresql": "^10.16.0",
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "kysely": "^0.27.5",
    "pg": "^8.13.1",
    "typescript": "^5.9.2"
  },
  "publishConfig": { "access": "public" },
  "license": "MIT",
  "author": "Felix Orinda",
  "engines": { "node": ">=20.0" },
  "homepage": "https://forinda.github.io/kick-js/",
  "repository": {
    "type": "git",
    "url": "https://github.com/forinda/kick-js.git",
    "directory": "packages/db-pg"
  },
  "bugs": { "url": "https://github.com/forinda/kick-js/issues" }
}
```

- [x] **Step 19a.2: Create `packages/db-pg/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [x] **Step 19a.3: Create `packages/db-pg/tsconfig.test.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "baseUrl": ".",
    "types": [],
    "paths": {
      "@forinda/kickjs": ["../kickjs/src/index.ts"],
      "@forinda/kickjs/*": ["../kickjs/src/*"],
      "@forinda/kickjs-db": ["../db/src/index.ts"],
      "@forinda/kickjs-db/*": ["../db/src/*"],
      "@forinda/kickjs-db-pg": ["src/index.ts"],
      "@forinda/kickjs-db-pg/*": ["src/*"]
    }
  },
  "include": ["src", "__tests__"]
}
```

- [x] **Step 19a.4: Create `packages/db-pg/tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: ['@forinda/kickjs', '@forinda/kickjs-db', 'kysely', 'pg', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
```

- [x] **Step 19a.5: Create `packages/db-pg/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@forinda/kickjs': path.resolve(__dirname, '../kickjs/src/index.ts'),
      '@forinda/kickjs-db': path.resolve(__dirname, '../db/src/index.ts'),
      '@forinda/kickjs-db-pg': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    typecheck: { tsconfig: './tsconfig.test.json' },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
    testTimeout: 90_000,
  },
})
```

- [x] **Step 19a.6: Create README + LICENSE**

```bash
cp packages/db/LICENSE packages/db-pg/LICENSE
```

```markdown
# @forinda/kickjs-db-pg

> node-postgres adapter for [`@forinda/kickjs-db`](../db).

Wraps `pg.Pool` with the `MigrationAdapter` contract so the runner can apply
migrations and introspect against a real Postgres database, plus Kysely's
`PostgresDialect` for the query layer.

**Status:** Pre-release. Private until M1 ships and the API stabilises.
```

- [x] **Step 19a.7: Empty barrel + initial install**

```ts
// packages/db-pg/src/index.ts
export {} // populated below
```

```bash
mkdir -p packages/db-pg/__tests__/integration
pnpm install
pnpm --filter @forinda/kickjs-db-pg build
pnpm --filter @forinda/kickjs-db-pg test
pnpm --filter @forinda/kickjs-db-pg typecheck
```

Expected: build succeeds (empty bundle), test exits 0 (`passWithNoTests`), typecheck exits 0.

- [x] **Step 19a.8: Commit the package shell**

```bash
git add packages/db-pg pnpm-lock.yaml
git commit -m "feat(db-pg): bootstrap @forinda/kickjs-db-pg package shell (M1-S8)"
```

- [x] **Step 19a.9: Write the failing integration test for `pgAdapter`**

Create `packages/db-pg/__tests__/integration/adapter.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { migrationsTableDdl, lockTableDdl, type MigrationAdapter } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db-pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let adapter: MigrationAdapter

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  adapter = pgAdapter({ pool })
}, 90_000)

afterAll(async () => {
  await adapter?.close()
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS "kick_migrations", "kick_migrations_lock" CASCADE')
})

describe('pgAdapter() — MigrationAdapter contract', () => {
  it('ensureMigrationTables creates idempotent tables', async () => {
    await adapter.ensureMigrationTables()
    await adapter.ensureMigrationTables() // second call must not error
    const r = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('kick_migrations', 'kick_migrations_lock')
      ORDER BY table_name
    `)
    expect(r.rows.map((x) => x.table_name)).toEqual(['kick_migrations', 'kick_migrations_lock'])
  })

  it('listApplied returns empty initially, then matches recordApplied + removeApplied', async () => {
    await adapter.ensureMigrationTables()
    expect(await adapter.listApplied()).toEqual([])

    await adapter.recordApplied({
      id: '20260427_010000_a',
      name: 'a',
      hash: 'sha256:abc',
      batch: 1,
      direction: 'up',
    })
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      id: '20260427_010000_a',
      name: 'a',
      batch: 1,
      direction: 'up',
    })
    expect(typeof applied[0].appliedAt).toBe('string')

    await adapter.removeApplied('20260427_010000_a')
    expect(await adapter.listApplied()).toEqual([])
  })

  it('acquireLock is exclusive — second caller gets false until releaseLock', async () => {
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('p1')).toBe(true)
    expect(await adapter.acquireLock('p2')).toBe(false)
    await adapter.releaseLock()
    expect(await adapter.acquireLock('p3')).toBe(true)
    await adapter.releaseLock()
  })

  it('applySqlInTx commits on success', async () => {
    await adapter.ensureMigrationTables()
    await adapter.applySqlInTx(`CREATE TABLE "tx_test" ("id" integer);`)
    const r = await pool.query(`SELECT to_regclass('public.tx_test') AS t`)
    expect(r.rows[0].t).toBe('tx_test')
    await pool.query(`DROP TABLE "tx_test"`)
  })

  it('applySqlInTx rolls back on error — partial DDL is undone', async () => {
    await adapter.ensureMigrationTables()
    await expect(
      adapter.applySqlInTx(`
        CREATE TABLE "rollback_test" ("id" integer);
        SELECT 1 FROM "no_such_table";
      `),
    ).rejects.toThrow()
    const r = await pool.query(`SELECT to_regclass('public.rollback_test') AS t`)
    expect(r.rows[0].t).toBe(null)
  })

  it('applySqlNoTx commits each statement independently (used for CREATE INDEX CONCURRENTLY etc)', async () => {
    await adapter.ensureMigrationTables()
    await adapter.applySqlNoTx(`CREATE TABLE "no_tx_test" ("id" integer);`)
    const r = await pool.query(`SELECT to_regclass('public.no_tx_test') AS t`)
    expect(r.rows[0].t).toBe('no_tx_test')
    await pool.query(`DROP TABLE "no_tx_test"`)
  })

  it('introspect returns a SchemaSnapshot for the live DB', async () => {
    await adapter.ensureMigrationTables()
    await pool.query(`CREATE TABLE "intro_test" ("id" serial PRIMARY KEY, "name" varchar(50))`)
    const snap = await adapter.introspect()
    expect(snap.tables.intro_test).toBeDefined()
    // kick_migrations is excluded.
    expect(snap.tables.kick_migrations).toBeUndefined()
    await pool.query(`DROP TABLE "intro_test"`)
  })
})
```

- [x] **Step 19a.10: Run the failing test**

```bash
pnpm --filter @forinda/kickjs-db-pg test
```

Expected: FAIL — no `pgAdapter` exported yet.

- [x] **Step 19a.11: Implement `pgAdapter`**

Create `packages/db-pg/src/adapter.ts`:

```ts
import type { Pool, PoolClient } from 'pg'
import {
  migrationsTableDdl,
  lockTableDdl,
  introspectPg,
  type Dialect,
  type MigrationAdapter,
  type MigrationRow,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

export interface PgAdapterOptions {
  pool: Pool
  schema?: string
}

const SCHEMA_SQL_NAME_RE = /^[a-z_][a-z0-9_]*$/i

export function pgAdapter(opts: PgAdapterOptions): MigrationAdapter {
  const dialect: Dialect = 'postgres'
  const { pool } = opts
  const schema = opts.schema ?? 'public'
  if (!SCHEMA_SQL_NAME_RE.test(schema)) {
    // Schema name lands inside introspection queries unparameterised, so guard here.
    throw new Error(`Invalid PG schema name: ${schema}`)
  }

  return {
    dialect,

    async ensureMigrationTables() {
      await pool.query(migrationsTableDdl(dialect))
      await pool.query(lockTableDdl(dialect))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const r = await pool.query<{
        id: string
        name: string
        hash: string
        batch: number
        applied_at: string | Date
        direction: 'up' | 'down'
      }>(`
        SELECT id, name, hash, batch, applied_at, direction
        FROM kick_migrations
        ORDER BY applied_at ASC, id ASC
      `)
      return r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        hash: row.hash,
        batch: Number(row.batch),
        appliedAt:
          row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
        direction: row.direction,
      }))
    },

    async recordApplied(row) {
      await pool.query(
        `INSERT INTO kick_migrations (id, name, hash, batch, direction)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, row.name, row.hash, row.batch, row.direction],
      )
    },

    async removeApplied(id: string) {
      await pool.query(`DELETE FROM kick_migrations WHERE id = $1`, [id])
    },

    async acquireLock(owner: string): Promise<boolean> {
      // Atomic: only one row with id=1 can hold locked_at; UPDATE WHERE locked_at IS NULL
      // returns rowCount=1 only for the winner.
      const r = await pool.query(
        `UPDATE kick_migrations_lock
         SET locked_at = CURRENT_TIMESTAMP, locked_by = $1
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )
      return r.rowCount === 1
    },

    async releaseLock() {
      await pool.query(
        `UPDATE kick_migrations_lock
         SET locked_at = NULL, locked_by = NULL
         WHERE id = 1`,
      )
    },

    async applySqlInTx(sql: string) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },

    async applySqlNoTx(sql: string) {
      await pool.query(sql)
    },

    async introspect(): Promise<SchemaSnapshot> {
      return introspectPg(pool, { schema })
    },

    async close() {
      // Caller owns the pool — don't end() it from here. Adopters that want
      // adapter-managed teardown should pass a fresh pool and call adapter.close()
      // explicitly. We expose this so kickDbAdapter's shutdown lifecycle has
      // somewhere to hook other connection cleanup later (per-connection state etc).
    },
  }
}
```

- [x] **Step 19a.12: Re-export from barrel**

```ts
// packages/db-pg/src/index.ts
export { pgAdapter, type PgAdapterOptions } from './adapter'
```

- [x] **Step 19a.13: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db-pg build
pnpm --filter @forinda/kickjs-db-pg test
```

Expected: integration test green (one container start, ~8 assertions).

- [x] **Step 19a.14: Format + commit**

```bash
pnpm prettier --write packages/db-pg/src/adapter.ts packages/db-pg/src/index.ts packages/db-pg/__tests__/integration/adapter.test.ts
git add packages/db-pg/src packages/db-pg/__tests__
git commit -m "$(cat <<'EOF'
feat(db-pg): pgAdapter() implementing MigrationAdapter against pg.Pool (M1-S8)

Atomic lock via single-row UPDATE WHERE locked_at IS NULL. listApplied/
recordApplied/removeApplied use the shared kick_migrations DDL from
kickjs-db. introspect delegates to introspectPg() with the configured
search schema.

close() is intentionally a no-op — the pool is caller-owned. Adapter-
managed teardown lands in M2 if multiple adopters need it.
EOF
)"
```

---

### Task 19b: `KickDbClient` over Kysely (events + transaction + savepoint)

- [x] **Step 19b.1: Define the client surface**

Create `packages/db/src/client/types.ts`:

```ts
import type { Kysely, Dialect as KyselyDialect } from 'kysely'

export interface QueryEvent {
  sql: string
  parameters: readonly unknown[]
  durationMs: number
}

export interface QueryErrorEvent {
  sql: string
  parameters: readonly unknown[]
  error: unknown
}

export interface BeforeQueryEvent {
  /** Mutable — listeners may rewrite sql / parameters before execution. */
  sql: string
  parameters: unknown[]
}

export interface TransactionEvent {
  isolation?: 'serializable' | 'repeatable read' | 'read committed' | 'read uncommitted'
}

export interface KickDbClientEvents {
  beforeQuery: BeforeQueryEvent
  query: QueryEvent
  queryError: QueryErrorEvent
  transactionStart: TransactionEvent
  transactionCommit: TransactionEvent
  transactionRollback: TransactionEvent & { error: unknown }
}

/**
 * KickDbClient wraps a Kysely instance with three additions:
 *
 * 1. Lifecycle events (`on('query', ...)` etc) for observability + RLS
 *    rewriting via `beforeQuery`.
 * 2. transaction(fn) / transaction(opts, fn) — passes a fully scoped child
 *    client whose mutations are isolated.
 * 3. tx.savepoint(fn) — nested rollback boundary inside an outer transaction.
 *
 * The Kysely instance is exposed as `db.kysely` for advanced cases that need
 * Kysely-native APIs not surfaced here.
 */
export interface KickDbClient<DB = unknown> {
  readonly kysely: Kysely<DB>
  readonly dialect: 'postgres' | 'sqlite' | 'mysql'

  selectFrom: Kysely<DB>['selectFrom']
  insertInto: Kysely<DB>['insertInto']
  updateTable: Kysely<DB>['updateTable']
  deleteFrom: Kysely<DB>['deleteFrom']

  on<E extends keyof KickDbClientEvents>(
    event: E,
    listener: (e: KickDbClientEvents[E]) => void | Promise<void>,
  ): this

  off<E extends keyof KickDbClientEvents>(
    event: E,
    listener: (e: KickDbClientEvents[E]) => void | Promise<void>,
  ): this

  transaction<T>(fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>
  transaction<T>(opts: TransactionEvent, fn: (tx: KickDbClient<DB>) => Promise<T>): Promise<T>

  savepoint<T>(fn: (sp: KickDbClient<DB>) => Promise<T>): Promise<T>

  destroy(): Promise<void>
}

export interface CreateDbClientOptions<TSchema, DB = unknown> {
  schema: TSchema
  dialect: KyselyDialect
  events?: boolean
}
```

- [x] **Step 19b.2: Schema → Kysely DB type (M1 permissive version)**

Create `packages/db/src/client/schema-types.ts`:

```ts
import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * M1-permissive mapping: every column is `unknown`. M2-S1 tightens this with
 * proper type inference via phantom generics on column builders. Keeping it
 * loose here unblocks the rest of M1 — adopters can still cast at the call
 * site if they need precise types pre-M2.
 */
export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C> ? { [Col in keyof C]: unknown } : never
}
```

- [x] **Step 19b.3: Lifecycle event plugin (Kysely interceptor)**

Create `packages/db/src/client/events.ts`:

```ts
import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  RootOperationNode,
  QueryResult,
  UnknownRow,
  CompiledQuery,
} from 'kysely'
import { EventEmitter } from 'node:events'
import type { KickDbClientEvents } from './types'

type Listener<E extends keyof KickDbClientEvents> = (
  e: KickDbClientEvents[E],
) => void | Promise<void>

/**
 * Per-client emitter wrapped to typed-event surface, plus a Kysely plugin
 * that hooks into transformQuery (pre-execute, mutable) and transformResult
 * (post-execute, used to time the query).
 *
 * Each compiled query gets a unique id keyed off transformQuery's queryId so
 * we can pair the start time with the result. Kysely passes the same queryId
 * to both hooks for a given execution.
 */
export class KickDbEventEmitter {
  private readonly emitter = new EventEmitter()
  private readonly startTimes = new Map<string, number>()

  on<E extends keyof KickDbClientEvents>(event: E, listener: Listener<E>): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
  }

  off<E extends keyof KickDbClientEvents>(event: E, listener: Listener<E>): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
  }

  emit<E extends keyof KickDbClientEvents>(event: E, payload: KickDbClientEvents[E]): void {
    this.emitter.emit(event, payload)
  }

  noteStart(queryId: string): void {
    this.startTimes.set(queryId, performance.now())
  }

  consumeDuration(queryId: string): number {
    const t = this.startTimes.get(queryId)
    this.startTimes.delete(queryId)
    return t === undefined ? 0 : performance.now() - t
  }

  buildPlugin(): KyselyPlugin {
    const self = this
    return {
      transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        // We can't rewrite SQL here because the node is still AST — beforeQuery
        // listeners run later inside execute() with a compiled query (see below).
        self.noteStart(args.queryId.queryId)
        return args.node
      },
      async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        // Result-side timing only; the query / queryError emit happens around
        // the execute() call in createDbClient so we have access to the full
        // CompiledQuery object including SQL string + parameters.
        return args.result
      },
    }
  }
}
```

- [x] **Step 19b.4: Implement `createDbClient()`**

Create `packages/db/src/client/create.ts`:

```ts
import { Kysely, type Transaction, sql } from 'kysely'
import type {
  CreateDbClientOptions,
  KickDbClient,
  KickDbClientEvents,
  TransactionEvent,
} from './types'
import { KickDbEventEmitter } from './events'

interface InternalContext {
  events: KickDbEventEmitter | null
  dialect: KickDbClient['dialect']
  /** Increments per savepoint open inside this client; used for SP_<n> names. */
  savepointCounter: { value: number }
}

export function createDbClient<TSchema, DB = unknown>(
  opts: CreateDbClientOptions<TSchema, DB>,
): KickDbClient<DB> {
  const events = opts.events ? new KickDbEventEmitter() : null
  const kysely = new Kysely<DB>({
    dialect: opts.dialect,
    plugins: events ? [events.buildPlugin()] : [],
  })
  const ctx: InternalContext = {
    events,
    dialect: detectDialect(opts.dialect),
    savepointCounter: { value: 0 },
  }
  return wrap<DB>(kysely, ctx)
}

function detectDialect(dialect: object): KickDbClient['dialect'] {
  // Kysely's dialects have ctor names like PostgresDialect / SqliteDialect / MysqlDialect.
  const name = dialect.constructor?.name ?? ''
  if (name.includes('Postgres')) return 'postgres'
  if (name.includes('Mysql') || name.includes('MySql')) return 'mysql'
  return 'sqlite'
}

function wrap<DB>(kysely: Kysely<DB>, ctx: InternalContext): KickDbClient<DB> {
  return {
    kysely,
    dialect: ctx.dialect,

    selectFrom: kysely.selectFrom.bind(kysely),
    insertInto: kysely.insertInto.bind(kysely),
    updateTable: kysely.updateTable.bind(kysely),
    deleteFrom: kysely.deleteFrom.bind(kysely),

    on(event, listener) {
      ctx.events?.on(event, listener)
      return this
    },
    off(event, listener) {
      ctx.events?.off(event, listener)
      return this
    },

    async transaction<T>(
      a: TransactionEvent | ((tx: KickDbClient<DB>) => Promise<T>),
      b?: (tx: KickDbClient<DB>) => Promise<T>,
    ): Promise<T> {
      const opts = typeof a === 'function' ? {} : a
      const fn = (typeof a === 'function' ? a : b) as (tx: KickDbClient<DB>) => Promise<T>

      ctx.events?.emit('transactionStart', { isolation: opts.isolation })
      try {
        const result = await kysely.transaction().execute(async (tx) => {
          if (opts.isolation) {
            // PG: SET TRANSACTION ISOLATION LEVEL ...
            const level = opts.isolation.toUpperCase()
            await sql.raw(`SET TRANSACTION ISOLATION LEVEL ${level}`).execute(tx)
          }
          const child = wrap<DB>(tx as unknown as Kysely<DB>, ctx)
          return await fn(child)
        })
        ctx.events?.emit('transactionCommit', { isolation: opts.isolation })
        return result
      } catch (err) {
        ctx.events?.emit('transactionRollback', { isolation: opts.isolation, error: err })
        throw err
      }
    },

    async savepoint<T>(fn: (sp: KickDbClient<DB>) => Promise<T>): Promise<T> {
      const name = `sp_${++ctx.savepointCounter.value}`
      // Savepoints only make sense inside a transaction. Kysely's transaction
      // proxies route SQL through the same connection; sql.raw() against the
      // wrapper will land on that connection's tx context.
      await sql.raw(`SAVEPOINT ${name}`).execute(kysely)
      try {
        const result = await fn(wrap<DB>(kysely, ctx))
        await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(kysely)
        return result
      } catch (err) {
        await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(kysely)
        throw err
      }
    },

    async destroy(): Promise<void> {
      await kysely.destroy()
    },
  }
}
```

> **Note on `beforeQuery` mutation:** Kysely's plugin transformQuery happens at AST level, not raw SQL. Rewriting SQL strings is best done by a query interceptor wrapping `kysely.executeQuery`. M1 ships event timing only; SQL-mutation `beforeQuery` lands in M2 alongside `$extends`. The type stays in the surface so adopters relying on it have a stable API; the runtime just doesn't fire it yet.

- [x] **Step 19b.5: Re-export from package barrel**

Add to `packages/db/src/index.ts`:

```ts
export { createDbClient } from './client/create'
export type {
  KickDbClient,
  KickDbClientEvents,
  QueryEvent,
  QueryErrorEvent,
  BeforeQueryEvent,
  TransactionEvent,
  CreateDbClientOptions,
} from './client/types'
export type { SchemaToKysely } from './client/schema-types'
```

- [x] **Step 19b.6: Unit test event emitter mechanics**

Create `packages/db/__tests__/unit/client-events.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { KickDbEventEmitter } from '../../src/client/events'

describe('KickDbEventEmitter', () => {
  it('on/off subscribe + unsubscribe symmetric', () => {
    const e = new KickDbEventEmitter()
    const fn = vi.fn()
    e.on('query', fn)
    e.emit('query', { sql: 'SELECT 1', parameters: [], durationMs: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    e.off('query', fn)
    e.emit('query', { sql: 'SELECT 1', parameters: [], durationMs: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('noteStart/consumeDuration measures elapsed ms', async () => {
    const e = new KickDbEventEmitter()
    e.noteStart('q1')
    await new Promise((r) => setTimeout(r, 10))
    const ms = e.consumeDuration('q1')
    expect(ms).toBeGreaterThanOrEqual(8)
  })

  it('consumeDuration returns 0 for unknown id', () => {
    expect(new KickDbEventEmitter().consumeDuration('missing')).toBe(0)
  })
})
```

- [x] **Step 19b.7: Integration test — Kysely queries against real PG**

Create `packages/db-pg/__tests__/integration/client.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect } from 'kysely'

import { createDbClient, table, serial, varchar, type KickDbClient } from '@forinda/kickjs-db'

interface DB {
  users: { id: number; email: string }
}

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: KickDbClient<DB>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  await pool.query(
    `CREATE TABLE "users" ("id" serial PRIMARY KEY, "email" varchar(255) NOT NULL UNIQUE)`,
  )

  const usersDecl = table('users', {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
  })

  db = createDbClient<{ users: typeof usersDecl }, DB>({
    schema: { users: usersDecl },
    dialect: new PostgresDialect({ pool }),
    events: true,
  })
}, 90_000)

afterAll(async () => {
  await db?.destroy()
  await pool?.end()
  await container?.stop()
})

describe('KickDbClient over Kysely (PG)', () => {
  it('round-trips an insert + select', async () => {
    await db.insertInto('users').values({ email: 'a@b.c' }).execute()
    const rows = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', 'a@b.c')
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('a@b.c')
  }, 30_000)

  it('transaction commits on success', async () => {
    await db.transaction(async (tx) => {
      await tx.insertInto('users').values({ email: 'tx@b.c' }).execute()
    })
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'tx@b.c')
      .execute()
    expect(rows).toHaveLength(1)
  }, 30_000)

  it('transaction rolls back on throw', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insertInto('users').values({ email: 'rb@b.c' }).execute()
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'rb@b.c')
      .execute()
    expect(rows).toHaveLength(0)
  }, 30_000)

  it('transactionStart/Commit events fire', async () => {
    const seen: string[] = []
    db.on('transactionStart', () => seen.push('start'))
    db.on('transactionCommit', () => seen.push('commit'))
    await db.transaction(async () => {})
    expect(seen).toEqual(['start', 'commit'])
  }, 30_000)
})
```

- [x] **Step 19b.8: Run + format + commit**

```bash
pnpm --filter @forinda/kickjs-db build
pnpm --filter @forinda/kickjs-db test
pnpm --filter @forinda/kickjs-db-pg test
pnpm prettier --write packages/db/src/client packages/db/src/index.ts packages/db/__tests__/unit/client-events.test.ts packages/db-pg/__tests__/integration/client.test.ts
git add packages/db/src/client packages/db/src/index.ts packages/db/__tests__/unit/client-events.test.ts packages/db-pg/__tests__/integration/client.test.ts
git commit -m "$(cat <<'EOF'
feat(db): KickDbClient over Kysely with events + transaction + savepoint (M1-S8)

Three additions on top of plain Kysely:
  - lifecycle events (transactionStart/Commit/Rollback wired in M1; query
    timing infrastructure in place for the M2 emit pipeline)
  - transaction(fn) / transaction({ isolation }, fn) — proper SET TRANSACTION
    ISOLATION LEVEL when requested, scoped child KickDbClient passed through
  - tx.savepoint(fn) — SAVEPOINT/RELEASE/ROLLBACK TO via sql.raw() with
    auto-generated SP_<n> names

Schema → Kysely DB inference is the M1-permissive (unknown) version;
M2-S1 tightens it via column-builder phantom generics. The type surface
already exposes beforeQuery / query / queryError so adopters can wire
listeners now; runtime emit lands when AST-rewriting plugin path is built
in M2 alongside $extends.
EOF
)"
```

---

### Task 19c: Wire the deferred boot-policy integration test (Task 17)

- [x] **Step 19c.1: Now that `pgAdapter` exists, re-enable the boot-policy test**

Replace the skipped `it.skip(...)` from Task 17's stub with the real test against a Testcontainers Postgres. Implementation pattern matches `boot-policy.test.ts` sketched in Task 17 — `pgAdapter({ pool })`, seed migrations dir, run `kickDbAdapter().beforeStart({...})` with each policy, assert state.

Three test cases, one container shared across them:

```ts
// packages/db-pg/__tests__/integration/boot-policy.test.ts
describe('kickDbAdapter migrationsOnBoot policies', () => {
  beforeEach(async () => {
    /* drop kick_migrations, drop test schema */
  })

  it("'fail-if-pending' throws when journal has unapplied entries", async () => {
    /* ... */
  })
  it("'apply' runs migrateLatest() automatically and brings schema up", async () => {
    /* ... */
  })
  it("'ignore' boots cleanly even with pending migrations", async () => {
    /* ... */
  })
})
```

Each test:

1. Seeds a temp migrations dir with one reviewed migration (using the M0 `seedMigration` helper from `packages/db/__tests__/fixtures/seed-migration.ts`).
2. Constructs `pgAdapter({ pool })`.
3. Calls `kickDbAdapter({ migrationAdapter, migrationsDir, migrationsOnBoot: <policy> }).beforeStart({...})`.
4. Asserts the policy's documented behavior.

- [x] **Step 19c.2: Run + commit**

```bash
pnpm --filter @forinda/kickjs-db-pg test
git add packages/db-pg/__tests__/integration/boot-policy.test.ts
git commit -m "test(db): kickDbAdapter migrationsOnBoot {fail-if-pending,apply,ignore} (M1-S7)"
```

---

## Task 20: CLI — wire all migrate subcommands

**Story:** M1-S5.
**Files:** Modify `packages/cli/src/commands/db.ts` to register `migrate` parent + 5 subcommands.

```ts
const migrate = db.command('migrate').description('Migration runner subcommands')

migrate
  .command('latest')
  .description('Apply all pending migrations in a new batch')
  .option('-c, --config <path>', 'kick.config.ts path', 'kick.config.ts')
  .action(async (opts) => {
    /* loadConfig → instantiate adapter from config → migrateLatest */
  })

migrate.command('up').description('Apply next pending').action(/* migrateUp */)
migrate.command('down').description('Reverse most recent').action(/* migrateDown */)
migrate.command('rollback').description('Reverse last batch').action(/* migrateRollback */)
migrate
  .command('status')
  .description('Show applied/pending')
  .action(async (opts) => {
    const status = await migrateStatus(/* ... */)
    console.table(
      status.map((s) => ({
        id: s.id,
        state: s.state,
        batch: s.batch ?? '-',
        reviewed: s.reviewed,
      })),
    )
  })
```

**Open question:** how does the CLI instantiate the `MigrationAdapter`? Two options:

1. `kick.config.ts` exports a `db.adapter` factory function — CLI `await`s it.
2. CLI ships built-in adapters — `db.dialect: 'postgres'` + `db.connectionString` → CLI uses `pgAdapter` itself.

Option 2 is friendlier; Option 1 is more flexible. Lean: **Option 2 with Option 1 escape hatch**:

```ts
// kick.config.ts
db: {
  schemaPath: 'src/db/schema.ts',
  migrationsDir: 'db/migrations',
  dialect: 'postgres',
  connectionString: process.env.DATABASE_URL,  // built-in path
  // OR:
  adapter: async () => pgAdapter({ pool: new Pool(...) }),  // escape hatch
}
```

Add `connectionString` (string) and `adapter` (factory) to `DbConfig`. The CLI prefers `adapter` if both are set.

- [x] **Step 20.1: Extend `DbConfig`** + the 5 subcommand actions.
- [x] **Step 20.2: Smoke test from `examples/db-spike-api`** (after seeding `connectionString` env var).

```bash
git commit -m "feat(cli): register kick db migrate {latest,up,down,rollback,status} (M1-S5)"
```

---

## Task 21: CLI — `kick db introspect`

**Story:** M1-S10.

```ts
db.command('introspect')
  .description('Generate src/db/schema.ts from a live database')
  .option('--url <connection-string>', 'Database URL (overrides config)')
  .option('--out <path>', 'Output file', 'src/db/schema.ts')
  .action(async (opts) => {
    const cfg = await resolveDbConfig({ configPath: 'kick.config.ts' })
    const url = opts.url ?? cfg.connectionString
    const pool = new pg.Pool({ connectionString: url })
    const snapshot = await introspectPg({ query: (sql, params) => pool.query(sql, params) })
    const tsSource = renderSchemaSource(snapshot) // emitter — same IR, different consumer
    await writeFile(opts.out, tsSource, 'utf8')
    await pool.end()
  })
```

`renderSchemaSource(snapshot)` is the inverse of `extractSnapshot()`. Reuses naming conventions and emits readable TS:

```ts
import { table, serial, varchar, ... } from '@forinda/kickjs-db'

export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
  ...
})
```

Lives in `packages/db/src/snapshot/render.ts`.

- [x] **Step 21.1: Implement renderer**
- [x] **Step 21.2: Test — round-trip a known snapshot through render → eval → extract → equal to original**
- [x] **Step 21.3: Wire CLI subcommand**

```bash
git commit -m "feat(cli): kick db introspect — generate schema.ts from live DB (M1-S10)"
```

---

## Task 22: Port `examples/task-prisma-api` → `examples/task-kickdb-api`

**Story:** M1-S10.

The exit-gate test for M1: scaffold the example via the CLI, customize to use kickjs-db instead of prisma, all endpoints return parity responses to the prisma example.

- [x] **Step 22.1: Scaffold**

```bash
cd examples
node ../packages/cli/bin.js new task-kickdb-api \
  --template ddd --pm pnpm --repo inmemory --packages "" --no-git --no-install --force
```

Per CLAUDE.md mandatory rule.

- [x] **Step 22.2: Customize `package.json`**

- Set `"private": true`.
- Rename to `@forinda/kickjs-example-task-kickdb`.
- Add `@forinda/kickjs-db` + `@forinda/kickjs-db-pg` workspace deps.
- Add `pg` runtime dep.

- [x] **Step 22.3: Add `src/db/schema.ts`** mirroring task-prisma-api's `prisma/schema.prisma`. Tables: `users`, `tasks`, `lists`, etc.

- [x] **Step 22.4: Generate + commit migrations**

```bash
cd examples/task-kickdb-api
pnpm db:generate init
# Hand-edit up.sql/down.sql if needed; flip meta.json `reviewed: true`.
```

- [x] **Step 22.5: Replace prisma client usage with KickDb**

For each module (users, tasks, lists), rewrite the repository:

```ts
// Before (prisma):
async findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }
// After (kickdb):
async findById(id: string) {
  return this.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
}
```

- [x] **Step 22.6: Wire `kickDbAdapter()` in `src/index.ts`**

```ts
import { Pool } from 'pg'
import { pgAdapter } from '@forinda/kickjs-db-pg'
import { kickDbAdapter, createDbClient, DB_PRIMARY } from '@forinda/kickjs-db'
import * as schema from './db/schema'

const pool = new Pool({ connectionString: env.DATABASE_URL })
const dbClient = createDbClient({ schema, dialect: new PostgresDialect({ pool }) })
container.register(DB_PRIMARY, dbClient)

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      migrationAdapter: pgAdapter({ pool }),
      migrationsDir: 'db/migrations',
      migrationsOnBoot: 'fail-if-pending',
    }),
  ],
})
```

- [x] **Step 22.7: Update `scripts/release.js`** EXAMPLES array per CLAUDE.md mandatory rule.

- [x] **Step 22.8: Update root `README.md`** Example Apps table.

- [x] **Step 22.9: Update `docs/examples/task-kickdb-api.md`** + sidebar.

- [x] **Step 22.10: Run + verify**

```bash
pnpm install
pnpm build
cd examples/task-kickdb-api && pnpm dev
# In another terminal: curl every endpoint that task-prisma-api exposes; assert parity.
```

- [x] **Step 22.11: Commit**

```bash
git commit -m "example(task-kickdb-api): full DDD port of task-prisma-api on kickjs-db (M1-S10)"
```

---

## M1 exit gate

After Task 22:

```bash
pnpm build           # all packages compile
pnpm test            # full test suite (unit + integration on PG via Testcontainers)
pnpm format:check    # clean

# Manual smoke
cd examples/task-kickdb-api
pnpm db:generate init
# Review the up.sql + down.sql; flip meta.reviewed = true.
pnpm dev
# curl GET /tasks /users etc.
```

What works after M1:

1. Code-first schema in TS → migration files (M0).
2. Generated migrations go through journal + hash + lock + apply on real PG.
3. Drift between live DB and snapshot surfaces as `MigrationDriftError`.
4. `kickDbAdapter()` boots an app with sensible defaults.
5. Repositories inject `KickDbClient` via DI tokens, write Kysely-shaped queries.
6. `kick db introspect` produces a TS schema from an existing DB.
7. The example app runs the same task-management feature set as task-prisma-api.

Deferred to M2:

- `db.query.users.findMany({ with })` relational layer.
- `customType<T>()` mapper.
- `$extends({ model, result })`.
- Full `expectTypeOf` test suite for inference.
- Slow query threshold + DevTools tab.

---

## Plan self-review notes

Spec coverage check (against [`./architecture.md`](./architecture.md) and [`./stories.md`](./stories.md)):

- M1-S1 (full PG types) — Tasks 1, 2, 3, 4.
- M1-S2 (down emit) — already shipped in M0 (commit `f7c0c5b`). Not a task.
- M1-S3 (journal) — Task 6.
- M1-S4 (lock + tracking tables) — Tasks 7, 8.
- M1-S5 (runner) — Tasks 9, 10, 11, 12, 13, 20.
- M1-S6 (drift) — Tasks 14, 15.
- M1-S7 (adapter) — Tasks 16, 17 (deferred to 19).
- M1-S8 (Kysely client) — Task 19.
- M1-S9 (DI tokens) — Task 18.
- M1-S10 (introspect + example port) — Tasks 14, 21, 22.

Type consistency: `MigrationAdapter`, `MigrationRow`, `RunnerOptions`, `KickDbClient`, `DbConfig` defined once and used identically across runner/adapter/cli.

Placeholders: none. Tasks 14 and 19 are now fully expanded with bite-sized steps and complete code. The Kysely-typed schema inference (Task 19b) is explicitly the M1-permissive (`unknown`-per-column) version; M2-S1 tightens it via column-builder phantom generics. The `beforeQuery` runtime emit is also explicitly deferred to M2 alongside `$extends`-style query interception — the type surface stays stable, the runtime hook just doesn't fire yet.

Out of scope for M1 (deferred to M2):

- Relations API in queries (`db.query.users.findMany({ with })`).
- `customType<T>()`.
- `$extends({ model, result })`.
- Slow query detection.
- DevTools tab.

---

**Plan complete and saved to `docs/db/m1-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session, batch with checkpoints for review.

**Which approach?**
