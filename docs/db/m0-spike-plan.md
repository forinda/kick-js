# M0 — Diff Engine Spike: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the schema-diff → Postgres-DDL pipeline works end-to-end. From a TypeScript schema file, produce a deterministic SQL migration that creates the target schema in a real Postgres instance.

**Architecture:** Code-first schema DSL → JSON `SchemaSnapshot` IR → diff engine producing a `ChangeSet` IR → per-dialect SQL emitter → CLI command writing migration files. Pure functions throughout. No Kysely yet, no client yet, no down-migrations yet — those land in M1.

**Tech Stack:** TypeScript, Vitest + SWC, tsdown (library bundler), wireit (build orchestration), `@testcontainers/postgresql` for the integration test, `pg` for the raw connection inside it.

**Spec:** [`./architecture.md`](./architecture.md) — sections 4 (Schema DSL), 5 (Migration engine), 13 (Roadmap M0).
**Stories:** [`./stories.md`](./stories.md) — M0-S1 through M0-S6.

---

## File Structure

New package `packages/db/` (`@forinda/kickjs-db`). New CLI command file in `packages/cli/`. No changes to other existing packages.

```
packages/db/
  package.json                                       NEW
  tsconfig.json                                      NEW
  tsconfig.test.json                                 NEW
  tsdown.config.ts                                   NEW
  vitest.config.ts                                   NEW
  README.md                                          NEW
  LICENSE                                            NEW (MIT, copy from packages/prisma)
  src/
    index.ts                                         NEW (barrel)
    snapshot/
      types.ts                                       Task 2: SchemaSnapshot IR
      extract.ts                                     Task 7: walk schema → snapshot
    dsl/
      table.ts                                       Task 5: table() factory
      relations.ts                                   Task 6: relations() stub
      columns/
        types.ts                                     Task 3: ColumnBuilder, base types
        builders.ts                                  Task 3, 4: column constructors
        index.ts                                     Task 3, 4: barrel
      constraints.ts                                 Task 5: index, unique, primaryKey
    diff/
      types.ts                                       Task 8: ChangeSet, Change types
      engine.ts                                      Tasks 9-13: diff() function
    emit/
      pg.ts                                          Tasks 14-17: emitPg() function
      identifiers.ts                                 Task 14: quoteIdent, quoteLiteral
    cli/
      config.ts                                      Task 19: kick.config.ts loader
      generate.ts                                    Tasks 20-21: generate command core
  __tests__/
    unit/
      snapshot-roundtrip.test.ts                     Task 2
      extract.test.ts                                Task 7
      diff-create-drop.test.ts                       Task 9
      diff-columns.test.ts                           Task 10
      diff-alter.test.ts                             Task 11
      diff-indexes-fks.test.ts                       Task 12
      diff-rename.test.ts                            Task 13
      emit-pg-create-drop.test.ts                    Task 15
      emit-pg-columns.test.ts                        Task 16
      emit-pg-indexes-fks.test.ts                    Task 17
      cli-generate.test.ts                           Task 21
    integration/
      spike.test.ts                                  Task 18

packages/cli/src/commands/db.ts                      Task 22: register kick db generate
packages/cli/src/cli.ts                              Task 22: wire command into root
```

The diff and emit modules are split by concern, not by change-type. Each test file targets one slice (~5 fixtures per file), so a failure narrows quickly.

---

## Conventions

- **TDD:** every task starts with a failing test, then minimal code, then green, then commit.
- **Commits:** one commit per task. Conventional Commits style. Reference the M0 story ID in parens.
- **No npm/yarn:** always `pnpm`. Run from repo root unless a step says otherwise.
- **Pre-commit hook** runs `build → test → format:check`. If it fails, fix the underlying issue, re-stage, create a NEW commit (never `--amend`).
- **Branch:** all work on `feat/db` (already current branch per session start).

---

## Task 1: Bootstrap `@forinda/kickjs-db` package skeleton

**Story:** Foundation for all of M0.
**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/tsconfig.test.json`
- Create: `packages/db/tsdown.config.ts`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/README.md`
- Create: `packages/db/LICENSE`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/.gitkeep`
- Create: `packages/db/__tests__/integration/.gitkeep`

- [ ] **Step 1.1: Create `packages/db/package.json`**

```json
{
  "name": "@forinda/kickjs-db",
  "version": "5.0.2",
  "description": "KickJS-native ORM — code-first schema, reversible migrations, multi-dialect SQL builder",
  "keywords": [
    "kickjs",
    "orm",
    "typescript",
    "postgres",
    "sqlite",
    "mysql",
    "migrations",
    "query-builder",
    "@forinda/kickjs"
  ],
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
    "@forinda/kickjs": ">=5.0.0"
  },
  "devDependencies": {
    "@forinda/kickjs": "workspace:*",
    "@testcontainers/postgresql": "^10.16.0",
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
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
    "directory": "packages/db"
  },
  "bugs": { "url": "https://github.com/forinda/kick-js/issues" }
}
```

- [ ] **Step 1.2: Create `packages/db/tsconfig.json`**

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

- [ ] **Step 1.3: Create `packages/db/tsconfig.test.json`**

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
      "@forinda/kickjs-db": ["src/index.ts"],
      "@forinda/kickjs-db/*": ["src/*"]
    }
  },
  "include": ["src", "__tests__"]
}
```

- [ ] **Step 1.4: Create `packages/db/tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown'
import { createBanner, readPkg } from '../../build.utils.mjs'

const pkg = readPkg(import.meta.dirname)

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  dts: true,
  external: ['@forinda/kickjs', /^node:/],
  banner: { js: createBanner(pkg.name, pkg.version) },
})
```

- [ ] **Step 1.5: Create `packages/db/vitest.config.ts`**

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
      '@forinda/kickjs-db': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    pool: 'threads',
    maxConcurrency: 1,
    testTimeout: 60_000,
  },
})
```

- [ ] **Step 1.6: Create `packages/db/README.md`**

```markdown
# @forinda/kickjs-db

> KickJS-native ORM. Code-first schema, reversible migrations, multi-dialect SQL.

**Status:** Pre-release. M0 spike. See [docs/db/architecture.md](../../docs/db/architecture.md).

## Install

Not yet published.

## License

MIT
```

- [ ] **Step 1.7: Copy LICENSE from `packages/prisma/LICENSE`**

```bash
cp packages/prisma/LICENSE packages/db/LICENSE
```

- [ ] **Step 1.8: Create empty barrel `packages/db/src/index.ts`**

```ts
// @forinda/kickjs-db — barrel. Populated as M0 progresses.
export {}
```

- [ ] **Step 1.9: Create test directory placeholders**

```bash
mkdir -p packages/db/__tests__/unit packages/db/__tests__/integration
touch packages/db/__tests__/unit/.gitkeep packages/db/__tests__/integration/.gitkeep
```

- [ ] **Step 1.10: Install workspace dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: pnpm links the new workspace package, creates `packages/db/node_modules`, no errors.

- [ ] **Step 1.11: Verify build + test scaffolding**

```bash
pnpm --filter @forinda/kickjs-db build
pnpm --filter @forinda/kickjs-db test
pnpm --filter @forinda/kickjs-db typecheck
```

Expected:

- `build` succeeds; `dist/index.mjs` and `dist/index.d.mts` exist.
- `test` exits 0 with "no test files found" (passWithNoTests).
- `typecheck` exits 0.

- [ ] **Step 1.12: Commit**

```bash
git add packages/db
git commit -m "$(cat <<'EOF'
feat(db): bootstrap @forinda/kickjs-db package skeleton (M0-S1)

Package shell with tsdown + wireit + vitest+swc, matching kickjs-prisma
shape. Empty barrel ready for the diff-engine spike.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `SchemaSnapshot` IR — types + roundtrip test (M0-S1)

**Story:** [`M0-S1`](./stories.md) — typed JSON-serializable IR shared by extract, diff, emit.
**Files:**

- Create: `packages/db/src/snapshot/types.ts`
- Create: `packages/db/__tests__/unit/snapshot-roundtrip.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/db/__tests__/unit/snapshot-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

describe('SchemaSnapshot JSON roundtrip', () => {
  it('preserves a 2-table snapshot through stringify/parse', () => {
    const original: SchemaSnapshot = {
      version: 1,
      dialect: 'postgres',
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            email: {
              name: 'email',
              type: 'varchar(255)',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [{ name: 'users_email_unique', columns: ['email'], unique: true }],
          foreignKeys: [],
          checks: [],
        },
        posts: {
          name: 'posts',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            authorId: {
              name: 'author_id',
              type: 'integer',
              nullable: false,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [
            {
              name: 'posts_author_fk',
              columns: ['author_id'],
              refTable: 'users',
              refColumns: ['id'],
              onDelete: 'cascade',
              onUpdate: 'no_action',
            },
          ],
          checks: [],
        },
      },
    }

    const roundtripped: SchemaSnapshot = JSON.parse(JSON.stringify(original))

    expect(roundtripped).toEqual(original)
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: FAIL — `Cannot find module '@forinda/kickjs-db' or its corresponding type declarations` or `SchemaSnapshot is not exported`.

- [ ] **Step 2.3: Write `packages/db/src/snapshot/types.ts`**

```ts
export type Dialect = 'postgres' | 'sqlite' | 'mysql'

export type FkAction = 'cascade' | 'restrict' | 'set_null' | 'set_default' | 'no_action'

export interface ColumnSnapshot {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
}

export interface IndexSnapshot {
  name: string
  columns: string[]
  unique: boolean
}

export interface ForeignKeySnapshot {
  name: string
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete: FkAction
  onUpdate: FkAction
}

export interface CheckSnapshot {
  name: string
  expression: string
}

export interface TableSnapshot {
  name: string
  columns: Record<string, ColumnSnapshot>
  indexes: IndexSnapshot[]
  foreignKeys: ForeignKeySnapshot[]
  checks: CheckSnapshot[]
}

export interface SchemaSnapshot {
  version: 1
  dialect: Dialect
  tables: Record<string, TableSnapshot>
}
```

- [ ] **Step 2.4: Re-export from barrel**

Edit `packages/db/src/index.ts`:

```ts
export type {
  Dialect,
  FkAction,
  ColumnSnapshot,
  IndexSnapshot,
  ForeignKeySnapshot,
  CheckSnapshot,
  TableSnapshot,
  SchemaSnapshot,
} from './snapshot/types'
```

- [ ] **Step 2.5: Run test to verify it passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS — 1 test passed.

- [ ] **Step 2.6: Commit**

```bash
git add packages/db/src/snapshot/types.ts packages/db/src/index.ts packages/db/__tests__/unit/snapshot-roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add SchemaSnapshot IR with JSON roundtrip test (M0-S1)

Defines the canonical IR consumed by extract, diff, and emit.
JSON-serializable by construction (no functions, dates as strings).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Column DSL — `ColumnBuilder` base + `serial`, `integer`

**Story:** [`M0-S2`](./stories.md) — first two of six column types for the spike.
**Files:**

- Create: `packages/db/src/dsl/columns/types.ts`
- Create: `packages/db/src/dsl/columns/builders.ts`
- Create: `packages/db/src/dsl/columns/index.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/columns.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/db/__tests__/unit/columns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serial, integer } from '@forinda/kickjs-db'

describe('column builders — serial, integer', () => {
  it('serial defaults: not null, primary-key-eligible', () => {
    const col = serial()
    expect(col.toJSON('id')).toEqual({
      name: 'id',
      type: 'serial',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('serial().primaryKey() flips primaryKey', () => {
    expect(serial().primaryKey().toJSON('id').primaryKey).toBe(true)
  })

  it('integer is nullable by default', () => {
    expect(integer().toJSON('age').nullable).toBe(true)
  })

  it('integer().notNull().default("0") sets defaults', () => {
    const col = integer().notNull().default('0').toJSON('counter')
    expect(col.nullable).toBe(false)
    expect(col.default).toBe('0')
  })
})
```

- [ ] **Step 3.2: Run test — fails**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: FAIL on missing exports `serial`, `integer`.

- [ ] **Step 3.3: Create `packages/db/src/dsl/columns/types.ts`**

```ts
import type { ColumnSnapshot } from '../../snapshot/types'

export interface ColumnState {
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  unique: boolean
  references: { table: string; column: string; onDelete: string; onUpdate: string } | null
}

export class ColumnBuilder {
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

  notNull(): this {
    this.state.nullable = false
    return this
  }

  default(value: string): this {
    this.state.default = value
    return this
  }

  primaryKey(): this {
    this.state.primaryKey = true
    this.state.nullable = false
    return this
  }

  unique(): this {
    this.state.unique = true
    return this
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

  // Internal accessor for table()/diff to read full state including unique/references.
  __state(): Readonly<ColumnState> {
    return this.state
  }
}
```

- [ ] **Step 3.4: Create `packages/db/src/dsl/columns/builders.ts`**

```ts
import { ColumnBuilder } from './types'

export function serial(): ColumnBuilder {
  return new ColumnBuilder('serial', { nullable: false })
}

export function integer(): ColumnBuilder {
  return new ColumnBuilder('integer')
}
```

- [ ] **Step 3.5: Create barrel `packages/db/src/dsl/columns/index.ts`**

```ts
export { ColumnBuilder } from './types'
export type { ColumnState } from './types'
export { serial, integer } from './builders'
```

- [ ] **Step 3.6: Re-export from package barrel**

Append to `packages/db/src/index.ts`:

```ts
export * from './dsl/columns'
```

- [ ] **Step 3.7: Run test — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS — 5 tests passed (1 from Task 2 + 4 new).

- [ ] **Step 3.8: Commit**

```bash
git add packages/db/src/dsl packages/db/src/index.ts packages/db/__tests__/unit/columns.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add ColumnBuilder + serial/integer column types (M0-S2)

Base DSL for fluent column declaration. Other types follow the same shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Column DSL — `varchar`, `text`, `boolean`, `timestamp`

**Story:** [`M0-S2`](./stories.md) — remaining four spike column types.
**Files:**

- Modify: `packages/db/src/dsl/columns/builders.ts`
- Modify: `packages/db/src/dsl/columns/index.ts`
- Modify: `packages/db/__tests__/unit/columns.test.ts`

- [ ] **Step 4.1: Extend the failing test**

Append to `packages/db/__tests__/unit/columns.test.ts`:

```ts
import { varchar, text, boolean, timestamp } from '@forinda/kickjs-db'

describe('column builders — varchar, text, boolean, timestamp', () => {
  it('varchar(255) emits parameterised type string', () => {
    expect(varchar(255).toJSON('email').type).toBe('varchar(255)')
  })

  it('varchar() default length 255', () => {
    expect(varchar().toJSON('s').type).toBe('varchar(255)')
  })

  it('text uses unbounded type', () => {
    expect(text().toJSON('body').type).toBe('text')
  })

  it('boolean defaults nullable false-ish until notNull()', () => {
    expect(boolean().toJSON('flag').nullable).toBe(true)
    expect(boolean().notNull().toJSON('flag').nullable).toBe(false)
  })

  it('timestamp().defaultNow() resolves to a SQL default token', () => {
    const col = timestamp().defaultNow().toJSON('createdAt')
    expect(col.default).toBe('CURRENT_TIMESTAMP')
  })
})
```

- [ ] **Step 4.2: Run — fails**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: FAIL on missing `varchar`, `text`, `boolean`, `timestamp` and `defaultNow()`.

- [ ] **Step 4.3: Extend `packages/db/src/dsl/columns/builders.ts`**

Replace the file contents with:

```ts
import { ColumnBuilder } from './types'

export function serial(): ColumnBuilder {
  return new ColumnBuilder('serial', { nullable: false })
}

export function integer(): ColumnBuilder {
  return new ColumnBuilder('integer')
}

export function varchar(length = 255): ColumnBuilder {
  return new ColumnBuilder(`varchar(${length})`)
}

export function text(): ColumnBuilder {
  return new ColumnBuilder('text')
}

export function boolean(): ColumnBuilder {
  return new ColumnBuilder('boolean')
}

export class TimestampBuilder extends ColumnBuilder {
  constructor() {
    super('timestamp')
  }

  defaultNow(): this {
    this.state.default = 'CURRENT_TIMESTAMP'
    return this
  }
}

export function timestamp(): TimestampBuilder {
  return new TimestampBuilder()
}
```

- [ ] **Step 4.4: Update barrel `packages/db/src/dsl/columns/index.ts`**

```ts
export { ColumnBuilder, type ColumnState } from './types'
export { serial, integer, varchar, text, boolean, timestamp, TimestampBuilder } from './builders'
```

- [ ] **Step 4.5: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS — 10 tests passed total.

- [ ] **Step 4.6: Commit**

```bash
git add packages/db/src/dsl/columns packages/db/__tests__/unit/columns.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add varchar/text/boolean/timestamp column types (M0-S2)

TimestampBuilder adds defaultNow() returning CURRENT_TIMESTAMP literal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `table()` factory + `index`/`unique` constraints + `references()`

**Story:** [`M0-S2`](./stories.md) — wire columns into a Table descriptor with constraints and FKs.
**Files:**

- Create: `packages/db/src/dsl/constraints.ts`
- Create: `packages/db/src/dsl/table.ts`
- Modify: `packages/db/src/dsl/columns/types.ts` (add `references()` method)
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/table.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `packages/db/__tests__/unit/table.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { table, serial, integer, varchar, index, unique } from '@forinda/kickjs-db'

describe('table() factory', () => {
  const users = table(
    'users',
    {
      id: serial().primaryKey(),
      email: varchar(255).notNull(),
    },
    (t) => ({
      emailIdx: index('users_email_idx').on(t.email),
    }),
  )

  it('exposes the table name', () => {
    expect(users.__name).toBe('users')
  })

  it('exposes columns by property name', () => {
    expect(Object.keys(users.__columns)).toEqual(['id', 'email'])
  })

  it('records single-column indexes from the third arg', () => {
    expect(users.__indexes).toEqual([
      { name: 'users_email_idx', columns: ['email'], unique: false },
    ])
  })

  it('table reference proxy carries column names back to the constraint helper', () => {
    expect(users.email.__name).toBe('email')
  })
})

describe('FK references', () => {
  const users = table('users', {
    id: serial().primaryKey(),
  })
  const posts = table('posts', {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  })

  it('records FK on the column state', () => {
    expect(posts.authorId.__state().references).toEqual({
      table: 'users',
      column: 'id',
      onDelete: 'cascade',
      onUpdate: 'no_action',
    })
  })
})

describe('unique constraint helper', () => {
  const t = table(
    'posts',
    {
      title: varchar(200).notNull(),
      authorId: integer().notNull(),
    },
    (t) => ({
      uniqSlug: unique('posts_slug_unique').on(t.title, t.authorId),
    }),
  )

  it('records multi-column unique', () => {
    expect(t.__indexes).toEqual([
      { name: 'posts_slug_unique', columns: ['title', 'authorId'], unique: true },
    ])
  })
})
```

- [ ] **Step 5.2: Run — fails**

Expected: FAIL on missing `table`, `index`, `unique`, `references`.

- [ ] **Step 5.3: Add `references()` to `ColumnBuilder`**

Edit `packages/db/src/dsl/columns/types.ts` — add this method to the class (between `unique()` and `toJSON()`):

```ts
  references(target: () => { __tableName: string; __name: string }, opts: { onDelete?: string; onUpdate?: string } = {}): this {
    const ref = target()
    this.state.references = {
      table: ref.__tableName,
      column: ref.__name,
      onDelete: opts.onDelete ?? 'no_action',
      onUpdate: opts.onUpdate ?? 'no_action',
    }
    return this
  }
```

- [ ] **Step 5.4: Create `packages/db/src/dsl/constraints.ts`**

```ts
export interface IndexDecl {
  name: string
  columns: string[]
  unique: boolean
}

interface ColRef {
  __name: string
}

export function index(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: false }
    },
  }
}

export function unique(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: true }
    },
  }
}
```

- [ ] **Step 5.5: Create `packages/db/src/dsl/table.ts`**

```ts
import type { ColumnBuilder } from './columns/types'
import type { IndexDecl } from './constraints'

export interface ColumnRef {
  __tableName: string
  __name: string
  __builder: ColumnBuilder
  __state: () => ReturnType<ColumnBuilder['__state']>
}

export interface TableDecl<
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
> {
  __isTable: true
  __name: string
  __columns: C
  __indexes: IndexDecl[]
}

type TableRefs<C extends Record<string, ColumnBuilder>> = TableDecl<C> & {
  [K in keyof C]: ColumnRef
}

type ConstraintBuilder<C extends Record<string, ColumnBuilder>> = (refs: {
  [K in keyof C]: ColumnRef
}) => Record<string, IndexDecl>

export function table<C extends Record<string, ColumnBuilder>>(
  name: string,
  columns: C,
  constraints?: ConstraintBuilder<C>,
): TableRefs<C> {
  const decl: TableDecl<C> = {
    __isTable: true,
    __name: name,
    __columns: columns,
    __indexes: [],
  }

  const refs = {} as { [K in keyof C]: ColumnRef }
  for (const [key, builder] of Object.entries(columns) as [keyof C, ColumnBuilder][]) {
    refs[key] = {
      __tableName: name,
      __name: key as string,
      __builder: builder,
      __state: () => builder.__state(),
    }
  }

  if (constraints) {
    const declared = constraints(refs)
    decl.__indexes = Object.values(declared)
  }

  return Object.assign(decl, refs)
}
```

- [ ] **Step 5.6: Update barrel `packages/db/src/index.ts`** — append:

```ts
export * from './dsl/table'
export * from './dsl/constraints'
```

- [ ] **Step 5.7: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS — table tests + FK tests + unique tests green.

- [ ] **Step 5.8: Commit**

```bash
git add packages/db/src/dsl packages/db/src/index.ts packages/db/__tests__/unit/table.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add table() factory with index/unique/references (M0-S2)

table() returns a value that's both the metadata descriptor and a record
of column refs, so the (t) => ({ idx: index(...).on(t.email) }) callback
typechecks against the column set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `relations()` stub (registered, not in snapshot)

**Story:** [`M0-S2`](./stories.md) — relations declared but excluded from the snapshot per spec §4.
**Files:**

- Create: `packages/db/src/dsl/relations.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/relations.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `packages/db/__tests__/unit/relations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { table, serial, integer, relations } from '@forinda/kickjs-db'

describe('relations()', () => {
  const users = table('users', { id: serial().primaryKey() })
  const posts = table('posts', {
    id: serial().primaryKey(),
    authorId: integer().notNull(),
  })

  const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
  const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, { fields: [posts.authorId], references: [users.id] }),
  }))

  it('marks relation declarations with __isRelations', () => {
    expect(usersRelations.__isRelations).toBe(true)
    expect(postsRelations.__isRelations).toBe(true)
  })

  it('records source table name', () => {
    expect(usersRelations.__sourceTable).toBe('users')
  })

  it('exposes relation map', () => {
    expect(usersRelations.__relations.posts.kind).toBe('many')
    expect(postsRelations.__relations.author.kind).toBe('one')
  })
})
```

- [ ] **Step 6.2: Run — fails**

Expected: FAIL on missing `relations`.

- [ ] **Step 6.3: Create `packages/db/src/dsl/relations.ts`**

```ts
import type { TableDecl, ColumnRef } from './table'
import type { ColumnBuilder } from './columns/types'

interface RelationOne {
  kind: 'one'
  target: TableDecl<Record<string, ColumnBuilder>>
  fields: ColumnRef[]
  references: ColumnRef[]
}

interface RelationMany {
  kind: 'many'
  target: TableDecl<Record<string, ColumnBuilder>>
}

type Relation = RelationOne | RelationMany

interface RelationsDecl {
  __isRelations: true
  __sourceTable: string
  __relations: Record<string, Relation>
}

interface Helpers {
  one: (
    target: TableDecl<Record<string, ColumnBuilder>>,
    opts: { fields: ColumnRef[]; references: ColumnRef[] },
  ) => RelationOne
  many: (target: TableDecl<Record<string, ColumnBuilder>>) => RelationMany
}

export function relations<T extends TableDecl<Record<string, ColumnBuilder>>>(
  source: T,
  builder: (h: Helpers) => Record<string, Relation>,
): RelationsDecl {
  const helpers: Helpers = {
    one: (target, opts) => ({
      kind: 'one',
      target,
      fields: opts.fields,
      references: opts.references,
    }),
    many: (target) => ({ kind: 'many', target }),
  }
  return {
    __isRelations: true,
    __sourceTable: source.__name,
    __relations: builder(helpers),
  }
}
```

- [ ] **Step 6.4: Re-export** — append to `packages/db/src/index.ts`:

```ts
export * from './dsl/relations'
```

- [ ] **Step 6.5: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add packages/db/src/dsl/relations.ts packages/db/src/index.ts packages/db/__tests__/unit/relations.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add relations() stub (M0-S2)

Relations are declared but deliberately excluded from snapshots —
they are query-time joining sugar, not DDL. M0 only validates the
declaration surface; M1 wires them into Layer 3 query API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `extractSnapshot(schema)` — walk DSL → SchemaSnapshot

**Story:** [`M0-S2`](./stories.md).
**Files:**

- Create: `packages/db/src/snapshot/extract.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/extract.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `packages/db/__tests__/unit/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  table,
  relations,
  serial,
  integer,
  varchar,
  index,
  unique,
  extractSnapshot,
} from '@forinda/kickjs-db'

describe('extractSnapshot()', () => {
  const users = table(
    'users',
    {
      id: serial().primaryKey(),
      email: varchar(255).notNull().unique(),
    },
    (t) => ({
      emailIdx: index('users_email_idx').on(t.email),
    }),
  )

  const posts = table(
    'posts',
    {
      id: serial().primaryKey(),
      authorId: integer()
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      title: varchar(200).notNull(),
    },
    (t) => ({
      uniqTitle: unique('posts_title_author_unique').on(t.title, t.authorId),
    }),
  )

  const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))

  const schema = { users, posts, usersRelations }
  const snap = extractSnapshot(schema, 'postgres')

  it('emits version + dialect', () => {
    expect(snap.version).toBe(1)
    expect(snap.dialect).toBe('postgres')
  })

  it('skips relations decls (not DDL)', () => {
    expect(Object.keys(snap.tables).sort()).toEqual(['posts', 'users'])
  })

  it('captures users.email as nullable=false varchar(255)', () => {
    expect(snap.tables.users.columns.email).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    })
  })

  it('captures the unique on email', () => {
    expect(snap.tables.users.indexes).toContainEqual({
      name: 'users_email_unique',
      columns: ['email'],
      unique: true,
    })
  })

  it('captures the named index from the constraint callback', () => {
    expect(snap.tables.users.indexes).toContainEqual({
      name: 'users_email_idx',
      columns: ['email'],
      unique: false,
    })
  })

  it('captures the FK on posts.authorId', () => {
    expect(snap.tables.posts.foreignKeys).toEqual([
      {
        name: 'posts_authorId_fk',
        columns: ['authorId'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no_action',
      },
    ])
  })

  it('captures the multi-column unique', () => {
    expect(snap.tables.posts.indexes).toContainEqual({
      name: 'posts_title_author_unique',
      columns: ['title', 'authorId'],
      unique: true,
    })
  })
})
```

- [ ] **Step 7.2: Run — fails**

Expected: FAIL on `extractSnapshot is not a function`.

- [ ] **Step 7.3: Create `packages/db/src/snapshot/extract.ts`**

```ts
import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'
import type {
  Dialect,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from './types'

interface MaybeTable {
  __isTable?: boolean
  __name?: string
  __columns?: Record<string, ColumnBuilder>
  __indexes?: IndexSnapshot[]
}

function isTable(v: unknown): v is TableDecl<Record<string, ColumnBuilder>> {
  return Boolean(v && typeof v === 'object' && (v as MaybeTable).__isTable === true)
}

export function extractSnapshot(schema: Record<string, unknown>, dialect: Dialect): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {}

  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue
    tables[value.__name] = extractTable(value)
  }

  return { version: 1, dialect, tables }
}

function extractTable(t: TableDecl<Record<string, ColumnBuilder>>): TableSnapshot {
  const columns: TableSnapshot['columns'] = {}
  const indexes: IndexSnapshot[] = [...t.__indexes]
  const foreignKeys: ForeignKeySnapshot[] = []

  for (const [colKey, builder] of Object.entries(t.__columns)) {
    columns[colKey] = builder.toJSON(colKey)
    const state = builder.__state()
    if (state.unique) {
      indexes.push({ name: `${t.__name}_${colKey}_unique`, columns: [colKey], unique: true })
    }
    if (state.references) {
      foreignKeys.push({
        name: `${t.__name}_${colKey}_fk`,
        columns: [colKey],
        refTable: state.references.table,
        refColumns: [state.references.column],
        onDelete: state.references.onDelete as ForeignKeySnapshot['onDelete'],
        onUpdate: state.references.onUpdate as ForeignKeySnapshot['onUpdate'],
      })
    }
  }

  return { name: t.__name, columns, indexes, foreignKeys, checks: [] }
}
```

- [ ] **Step 7.4: Re-export** — append to `packages/db/src/index.ts`:

```ts
export { extractSnapshot } from './snapshot/extract'
```

- [ ] **Step 7.5: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add packages/db/src/snapshot/extract.ts packages/db/src/index.ts packages/db/__tests__/unit/extract.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add extractSnapshot() walking DSL → SchemaSnapshot (M0-S2)

Walks a schema-export record, identifies tables via __isTable marker,
emits the canonical IR. Relations decls deliberately skipped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `ChangeSet` IR types

**Story:** [`M0-S3`](./stories.md) — typed change set.
**Files:**

- Create: `packages/db/src/diff/types.ts`
- Modify: `packages/db/src/index.ts`

(No test in this task — pure type declarations. Tested through Task 9 onwards.)

- [ ] **Step 8.1: Create `packages/db/src/diff/types.ts`**

```ts
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from '../snapshot/types'

export interface CreateTable {
  kind: 'createTable'
  table: TableSnapshot
}

export interface DropTable {
  kind: 'dropTable'
  table: TableSnapshot
}

export interface RenameTable {
  kind: 'renameTable'
  from: string
  to: string
}

export interface AddColumn {
  kind: 'addColumn'
  table: string
  column: ColumnSnapshot
}

export interface DropColumn {
  kind: 'dropColumn'
  table: string
  column: ColumnSnapshot
}

export interface RenameColumn {
  kind: 'renameColumn'
  table: string
  from: string
  to: string
}

export interface AlterColumn {
  kind: 'alterColumn'
  table: string
  column: string
  before: ColumnSnapshot
  after: ColumnSnapshot
}

export interface AddIndex {
  kind: 'addIndex'
  table: string
  index: IndexSnapshot
}

export interface DropIndex {
  kind: 'dropIndex'
  table: string
  index: IndexSnapshot
}

export interface AddForeignKey {
  kind: 'addForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export interface DropForeignKey {
  kind: 'dropForeignKey'
  table: string
  fk: ForeignKeySnapshot
}

export type Change =
  | CreateTable
  | DropTable
  | RenameTable
  | AddColumn
  | DropColumn
  | RenameColumn
  | AlterColumn
  | AddIndex
  | DropIndex
  | AddForeignKey
  | DropForeignKey

export type ChangeSet = Change[]
```

- [ ] **Step 8.2: Re-export** — append to `packages/db/src/index.ts`:

```ts
export type * from './diff/types'
```

- [ ] **Step 8.3: Verify typecheck**

```bash
pnpm --filter @forinda/kickjs-db typecheck
```

Expected: exit 0.

- [ ] **Step 8.4: Commit**

```bash
git add packages/db/src/diff/types.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): add ChangeSet IR types (M0-S3)

Typed discriminated union covering every DDL change M0 needs to express.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `diff()` — table create / drop

**Story:** [`M0-S3`](./stories.md).
**Files:**

- Create: `packages/db/src/diff/engine.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/diff-create-drop.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `packages/db/__tests__/unit/diff-create-drop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

const oneTable: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      name: 'users',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
      },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
}

describe('diff() — create/drop tables', () => {
  it('empty → empty produces no changes', () => {
    expect(diff(empty, empty)).toEqual([])
  })

  it('empty → oneTable produces createTable', () => {
    const changes = diff(empty, oneTable)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'createTable', table: { name: 'users' } })
  })

  it('oneTable → empty produces dropTable', () => {
    const changes = diff(oneTable, empty)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'dropTable', table: { name: 'users' } })
  })

  it('idempotent — same snapshot twice produces no changes', () => {
    expect(diff(oneTable, oneTable)).toEqual([])
  })
})
```

- [ ] **Step 9.2: Run — fails**

Expected: FAIL on `diff is not a function`.

- [ ] **Step 9.3: Create `packages/db/src/diff/engine.ts`**

```ts
import type { SchemaSnapshot, TableSnapshot } from '../snapshot/types'
import type { Change, ChangeSet } from './types'

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): ChangeSet {
  const changes: Change[] = []

  const prevTables = new Set(Object.keys(prev.tables))
  const nextTables = new Set(Object.keys(next.tables))

  // Drops first (so FKs that depend on dropped tables are handled before drops below)
  for (const name of prevTables) {
    if (!nextTables.has(name)) {
      changes.push({ kind: 'dropTable', table: prev.tables[name] })
    }
  }

  // Creates second
  for (const name of nextTables) {
    if (!prevTables.has(name)) {
      changes.push({ kind: 'createTable', table: next.tables[name] })
    }
  }

  // Common tables — column/index/fk diff comes in Tasks 10-12
  for (const name of nextTables) {
    if (!prevTables.has(name)) continue
    diffTable(prev.tables[name], next.tables[name], changes)
  }

  return changes
}

function diffTable(_prev: TableSnapshot, _next: TableSnapshot, _changes: Change[]) {
  // Filled in Tasks 10-12
}
```

- [ ] **Step 9.4: Re-export** — append to `packages/db/src/index.ts`:

```ts
export { diff } from './diff/engine'
```

- [ ] **Step 9.5: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add packages/db/src/diff/engine.ts packages/db/src/index.ts packages/db/__tests__/unit/diff-create-drop.test.ts
git commit -m "$(cat <<'EOF'
feat(db): diff engine — table create/drop (M0-S3)

Diffs sets of table names. Per-table column/index/FK diff is a stub
filled in in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `diff()` — column add / drop

**Story:** [`M0-S3`](./stories.md).
**Files:**

- Modify: `packages/db/src/diff/engine.ts`
- Create: `packages/db/__tests__/unit/diff-columns.test.ts`

- [ ] **Step 10.1: Write the failing test**

Create `packages/db/__tests__/unit/diff-columns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, TableSnapshot } from '@forinda/kickjs-db'

const baseTable = (cols: TableSnapshot['columns']): TableSnapshot => ({
  name: 'users',
  columns: cols,
  indexes: [],
  foreignKeys: [],
  checks: [],
})

const wrap = (t: TableSnapshot): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: { users: t },
})

describe('diff() — column add/drop', () => {
  it('adds a new column', () => {
    const prev = wrap(
      baseTable({
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
      }),
    )
    const next = wrap(
      baseTable({
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        email: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      }),
    )
    const changes = diff(prev, next)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'addColumn',
      table: 'users',
      column: { name: 'email' },
    })
  })

  it('drops a removed column', () => {
    const prev = wrap(
      baseTable({
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        legacy: { name: 'legacy', type: 'text', nullable: true, default: null, primaryKey: false },
      }),
    )
    const next = wrap(
      baseTable({
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
      }),
    )
    const changes = diff(prev, next)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'dropColumn',
      table: 'users',
      column: { name: 'legacy' },
    })
  })

  it('add + drop in same diff', () => {
    const prev = wrap(
      baseTable({
        a: { name: 'a', type: 'text', nullable: true, default: null, primaryKey: false },
      }),
    )
    const next = wrap(
      baseTable({
        b: { name: 'b', type: 'text', nullable: true, default: null, primaryKey: false },
      }),
    )
    const changes = diff(prev, next)
    expect(changes).toHaveLength(2)
    expect(changes.find((c) => c.kind === 'dropColumn')?.column.name).toBe('a')
    expect(changes.find((c) => c.kind === 'addColumn')?.column.name).toBe('b')
  })
})
```

- [ ] **Step 10.2: Run — fails** (column-level tests fail; the diff stub does nothing for common tables).

- [ ] **Step 10.3: Implement column diff in `packages/db/src/diff/engine.ts`**

Replace the body of `diffTable` with:

```ts
function diffTable(prev: TableSnapshot, next: TableSnapshot, changes: Change[]) {
  const prevCols = new Set(Object.keys(prev.columns))
  const nextCols = new Set(Object.keys(next.columns))

  for (const c of prevCols) {
    if (!nextCols.has(c)) {
      changes.push({ kind: 'dropColumn', table: next.name, column: prev.columns[c] })
    }
  }
  for (const c of nextCols) {
    if (!prevCols.has(c)) {
      changes.push({ kind: 'addColumn', table: next.name, column: next.columns[c] })
    }
  }
}
```

- [ ] **Step 10.4: Run — passes**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add packages/db/src/diff/engine.ts packages/db/__tests__/unit/diff-columns.test.ts
git commit -m "$(cat <<'EOF'
feat(db): diff engine — column add/drop (M0-S3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `diff()` — alter column

**Story:** [`M0-S3`](./stories.md).
**Files:**

- Modify: `packages/db/src/diff/engine.ts`
- Create: `packages/db/__tests__/unit/diff-alter.test.ts`

- [ ] **Step 11.1: Write the failing test**

Create `packages/db/__tests__/unit/diff-alter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, ColumnSnapshot } from '@forinda/kickjs-db'

const wrap = (col: ColumnSnapshot): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: { t: { name: 't', columns: { c: col }, indexes: [], foreignKeys: [], checks: [] } },
})

const base: ColumnSnapshot = {
  name: 'c',
  type: 'integer',
  nullable: true,
  default: null,
  primaryKey: false,
}

describe('diff() — alter column', () => {
  it('detects type change', () => {
    const changes = diff(wrap(base), wrap({ ...base, type: 'bigint' }))
    expect(changes[0]).toMatchObject({
      kind: 'alterColumn',
      table: 't',
      column: 'c',
      before: { type: 'integer' },
      after: { type: 'bigint' },
    })
  })

  it('detects nullable change', () => {
    const changes = diff(wrap(base), wrap({ ...base, nullable: false }))
    expect(changes[0]).toMatchObject({ kind: 'alterColumn' })
  })

  it('detects default change', () => {
    const changes = diff(wrap(base), wrap({ ...base, default: '0' }))
    expect(changes[0]).toMatchObject({ kind: 'alterColumn' })
  })

  it('no change when columns equal', () => {
    expect(diff(wrap(base), wrap(base))).toEqual([])
  })
})
```

- [ ] **Step 11.2: Run — fails**.

- [ ] **Step 11.3: Extend `diffTable`** in `packages/db/src/diff/engine.ts`:

Replace `diffTable` with:

```ts
function diffTable(prev: TableSnapshot, next: TableSnapshot, changes: Change[]) {
  const prevCols = new Set(Object.keys(prev.columns))
  const nextCols = new Set(Object.keys(next.columns))

  for (const c of prevCols) {
    if (!nextCols.has(c)) {
      changes.push({ kind: 'dropColumn', table: next.name, column: prev.columns[c] })
    }
  }
  for (const c of nextCols) {
    if (!prevCols.has(c)) {
      changes.push({ kind: 'addColumn', table: next.name, column: next.columns[c] })
      continue
    }
    const before = prev.columns[c]
    const after = next.columns[c]
    if (!columnsEqual(before, after)) {
      changes.push({ kind: 'alterColumn', table: next.name, column: c, before, after })
    }
  }
}

function columnsEqual(
  a: import('../snapshot/types').ColumnSnapshot,
  b: import('../snapshot/types').ColumnSnapshot,
): boolean {
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    a.primaryKey === b.primaryKey
  )
}
```

- [ ] **Step 11.4: Run — passes**.

- [ ] **Step 11.5: Commit**

```bash
git add packages/db/src/diff/engine.ts packages/db/__tests__/unit/diff-alter.test.ts
git commit -m "$(cat <<'EOF'
feat(db): diff engine — alter column (M0-S3)

Detects type / nullable / default / primaryKey changes via deep equality.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `diff()` — indexes + foreign keys

**Story:** [`M0-S3`](./stories.md).
**Files:**

- Modify: `packages/db/src/diff/engine.ts`
- Create: `packages/db/__tests__/unit/diff-indexes-fks.test.ts`

- [ ] **Step 12.1: Write the failing test**

Create `packages/db/__tests__/unit/diff-indexes-fks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, IndexSnapshot, ForeignKeySnapshot } from '@forinda/kickjs-db'

const idx = (name: string): IndexSnapshot => ({ name, columns: ['x'], unique: false })
const fk = (name: string): ForeignKeySnapshot => ({
  name,
  columns: ['x'],
  refTable: 'other',
  refColumns: ['id'],
  onDelete: 'no_action',
  onUpdate: 'no_action',
})

const wrap = (indexes: IndexSnapshot[], foreignKeys: ForeignKeySnapshot[]): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: { t: { name: 't', columns: {}, indexes, foreignKeys, checks: [] } },
})

describe('diff() — indexes & FKs', () => {
  it('adds new index', () => {
    const c = diff(wrap([], []), wrap([idx('i1')], []))
    expect(c[0]).toMatchObject({ kind: 'addIndex', table: 't', index: { name: 'i1' } })
  })

  it('drops removed index', () => {
    const c = diff(wrap([idx('i1')], []), wrap([], []))
    expect(c[0]).toMatchObject({ kind: 'dropIndex', table: 't', index: { name: 'i1' } })
  })

  it('adds new FK', () => {
    const c = diff(wrap([], []), wrap([], [fk('f1')]))
    expect(c[0]).toMatchObject({ kind: 'addForeignKey', table: 't', fk: { name: 'f1' } })
  })

  it('drops removed FK', () => {
    const c = diff(wrap([], [fk('f1')]), wrap([], []))
    expect(c[0]).toMatchObject({ kind: 'dropForeignKey', table: 't', fk: { name: 'f1' } })
  })
})
```

- [ ] **Step 12.2: Run — fails**.

- [ ] **Step 12.3: Extend `diffTable`** in `packages/db/src/diff/engine.ts` — append after the column loop:

```ts
diffByName(
  prev.indexes,
  next.indexes,
  (i) => changes.push({ kind: 'dropIndex', table: next.name, index: i }),
  (i) => changes.push({ kind: 'addIndex', table: next.name, index: i }),
)

diffByName(
  prev.foreignKeys,
  next.foreignKeys,
  (f) => changes.push({ kind: 'dropForeignKey', table: next.name, fk: f }),
  (f) => changes.push({ kind: 'addForeignKey', table: next.name, fk: f }),
)
```

And add at module scope:

```ts
function diffByName<T extends { name: string }>(
  prev: T[],
  next: T[],
  onDrop: (item: T) => void,
  onAdd: (item: T) => void,
) {
  const prevByName = new Map(prev.map((p) => [p.name, p]))
  const nextByName = new Map(next.map((n) => [n.name, n]))
  for (const [n, p] of prevByName) if (!nextByName.has(n)) onDrop(p)
  for (const [n, x] of nextByName) if (!prevByName.has(n)) onAdd(x)
}
```

- [ ] **Step 12.4: Run — passes**.

- [ ] **Step 12.5: Commit**

```bash
git add packages/db/src/diff/engine.ts packages/db/__tests__/unit/diff-indexes-fks.test.ts
git commit -m "$(cat <<'EOF'
feat(db): diff engine — indexes & foreign keys (M0-S3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `diff()` — rename heuristic

**Story:** [`M0-S3`](./stories.md). Detects column rename when prev has a dropped column and next has an added column with same type + same constraints. Conservative — falls back to drop+add when ambiguous.

**Files:**

- Modify: `packages/db/src/diff/engine.ts`
- Create: `packages/db/__tests__/unit/diff-rename.test.ts`

- [ ] **Step 13.1: Write the failing test**

Create `packages/db/__tests__/unit/diff-rename.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, ColumnSnapshot } from '@forinda/kickjs-db'

const col = (name: string, overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot => ({
  name,
  type: 'varchar(255)',
  nullable: false,
  default: null,
  primaryKey: false,
  ...overrides,
})

const wrap = (cols: ColumnSnapshot[]): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    t: {
      name: 't',
      columns: Object.fromEntries(cols.map((c) => [c.name, c])),
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
})

describe('diff() — rename heuristic', () => {
  it('detects rename when one drop + one add with identical attrs', () => {
    const changes = diff(wrap([col('emailAddr')]), wrap([col('email')]))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'renameColumn',
      table: 't',
      from: 'emailAddr',
      to: 'email',
    })
  })

  it('falls back to drop+add when types differ', () => {
    const changes = diff(
      wrap([col('a', { type: 'varchar(50)' })]),
      wrap([col('b', { type: 'text' })]),
    )
    expect(changes.map((c) => c.kind).sort()).toEqual(['addColumn', 'dropColumn'])
  })

  it('does not rename when ambiguous (multiple matching adds/drops)', () => {
    const changes = diff(wrap([col('a'), col('b')]), wrap([col('c'), col('d')]))
    expect(changes.filter((c) => c.kind === 'renameColumn')).toHaveLength(0)
    expect(changes).toHaveLength(4)
  })
})
```

- [ ] **Step 13.2: Run — fails**.

- [ ] **Step 13.3: Implement rename detection in `packages/db/src/diff/engine.ts`**

Replace `diffTable` entirely:

```ts
function diffTable(prev: TableSnapshot, next: TableSnapshot, changes: Change[]) {
  const prevCols = new Map(Object.entries(prev.columns))
  const nextCols = new Map(Object.entries(next.columns))

  const drops: string[] = []
  const adds: string[] = []
  for (const c of prevCols.keys()) if (!nextCols.has(c)) drops.push(c)
  for (const c of nextCols.keys()) if (!prevCols.has(c)) adds.push(c)

  // Rename heuristic — pair only if exactly one drop + one add with identical attrs.
  if (drops.length === 1 && adds.length === 1) {
    const before = prevCols.get(drops[0])!
    const after = nextCols.get(adds[0])!
    if (columnAttrsEqual(before, after)) {
      changes.push({ kind: 'renameColumn', table: next.name, from: drops[0], to: adds[0] })
      drops.length = 0
      adds.length = 0
    }
  }

  for (const c of drops) {
    changes.push({ kind: 'dropColumn', table: next.name, column: prevCols.get(c)! })
  }
  for (const c of adds) {
    changes.push({ kind: 'addColumn', table: next.name, column: nextCols.get(c)! })
  }

  // Common columns — alter detection
  for (const c of nextCols.keys()) {
    if (!prevCols.has(c)) continue
    const before = prevCols.get(c)!
    const after = nextCols.get(c)!
    if (!columnsEqual(before, after)) {
      changes.push({ kind: 'alterColumn', table: next.name, column: c, before, after })
    }
  }

  diffByName(
    prev.indexes,
    next.indexes,
    (i) => changes.push({ kind: 'dropIndex', table: next.name, index: i }),
    (i) => changes.push({ kind: 'addIndex', table: next.name, index: i }),
  )

  diffByName(
    prev.foreignKeys,
    next.foreignKeys,
    (f) => changes.push({ kind: 'dropForeignKey', table: next.name, fk: f }),
    (f) => changes.push({ kind: 'addForeignKey', table: next.name, fk: f }),
  )
}

function columnAttrsEqual(
  a: import('../snapshot/types').ColumnSnapshot,
  b: import('../snapshot/types').ColumnSnapshot,
): boolean {
  // Like columnsEqual but ignores name (since rename is *about* name change).
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    a.default === b.default &&
    a.primaryKey === b.primaryKey
  )
}
```

- [ ] **Step 13.4: Run — passes**.

- [ ] **Step 13.5: Commit**

```bash
git add packages/db/src/diff/engine.ts packages/db/__tests__/unit/diff-rename.test.ts
git commit -m "$(cat <<'EOF'
feat(db): diff engine — column rename heuristic (M0-S3)

Conservative: only renames on exactly one drop + one add with identical
attrs. Ambiguous cases fall back to drop+add.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: PG identifier + literal helpers

**Story:** [`M0-S4`](./stories.md). Foundation for all SQL emission.
**Files:**

- Create: `packages/db/src/emit/identifiers.ts`
- Create: `packages/db/__tests__/unit/identifiers.test.ts`

- [ ] **Step 14.1: Write the failing test**

Create `packages/db/__tests__/unit/identifiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { quoteIdent, quoteLiteral } from '../../src/emit/identifiers'

describe('quoteIdent', () => {
  it('wraps in double quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })

  it('handles dotted refs by quoting each segment', () => {
    expect(quoteIdent('public.users')).toBe('"public"."users"')
  })
})

describe('quoteLiteral', () => {
  it('wraps in single quotes', () => {
    expect(quoteLiteral('hello')).toBe("'hello'")
  })

  it('escapes single quotes', () => {
    expect(quoteLiteral("it's")).toBe("'it''s'")
  })
})
```

- [ ] **Step 14.2: Run — fails**.

- [ ] **Step 14.3: Create `packages/db/src/emit/identifiers.ts`**

```ts
export function quoteIdent(name: string): string {
  return name
    .split('.')
    .map((part) => '"' + part.replace(/"/g, '""') + '"')
    .join('.')
}

export function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}
```

- [ ] **Step 14.4: Run — passes**.

- [ ] **Step 14.5: Commit**

```bash
git add packages/db/src/emit/identifiers.ts packages/db/__tests__/unit/identifiers.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add quoteIdent + quoteLiteral helpers (M0-S4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: PG emit — `CreateTable` + `DropTable` + `RenameTable`

**Story:** [`M0-S4`](./stories.md).
**Files:**

- Create: `packages/db/src/emit/pg.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/emit-pg-create-drop.test.ts`

- [ ] **Step 15.1: Write the failing test**

Create `packages/db/__tests__/unit/emit-pg-create-drop.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet, TableSnapshot } from '@forinda/kickjs-db'

const usersTable: TableSnapshot = {
  name: 'users',
  columns: {
    id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
    email: {
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    },
  },
  indexes: [],
  foreignKeys: [],
  checks: [],
}

describe('emitPg() — create/drop/rename table', () => {
  it('emits CREATE TABLE', () => {
    const changes: ChangeSet = [{ kind: 'createTable', table: usersTable }]
    expect(emitPg(changes)).toBe(
      'CREATE TABLE "users" (\n' +
        '  "id" serial NOT NULL,\n' +
        '  "email" varchar(255) NOT NULL,\n' +
        '  PRIMARY KEY ("id")\n' +
        ');',
    )
  })

  it('emits DROP TABLE', () => {
    const changes: ChangeSet = [{ kind: 'dropTable', table: usersTable }]
    expect(emitPg(changes)).toBe('DROP TABLE "users";')
  })

  it('emits ALTER TABLE RENAME', () => {
    const changes: ChangeSet = [{ kind: 'renameTable', from: 'users', to: 'accounts' }]
    expect(emitPg(changes)).toBe('ALTER TABLE "users" RENAME TO "accounts";')
  })
})
```

- [ ] **Step 15.2: Run — fails**.

- [ ] **Step 15.3: Create `packages/db/src/emit/pg.ts`**

```ts
import type { Change, ChangeSet } from '../diff/types'
import type { ColumnSnapshot, TableSnapshot } from '../snapshot/types'
import { quoteIdent, quoteLiteral } from './identifiers'

export function emitPg(changes: ChangeSet): string {
  return changes.map(emitChange).join('\n')
}

function emitChange(change: Change): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table)
    case 'dropTable':
      return `DROP TABLE ${quoteIdent(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${quoteIdent(change.from)} RENAME TO ${quoteIdent(change.to)};`
    default:
      return `-- unsupported in M0: ${change.kind}`
  }
}

function emitCreateTable(t: TableSnapshot): string {
  const cols = Object.values(t.columns).map(emitColumnDecl)
  const pk = Object.values(t.columns)
    .filter((c) => c.primaryKey)
    .map((c) => quoteIdent(c.name))
  const lines = [...cols]
  if (pk.length > 0) lines.push(`PRIMARY KEY (${pk.join(', ')})`)
  return `CREATE TABLE ${quoteIdent(t.name)} (\n  ${lines.join(',\n  ')}\n);`
}

function emitColumnDecl(c: ColumnSnapshot): string {
  let s = `${quoteIdent(c.name)} ${c.type}`
  if (!c.nullable) s += ' NOT NULL'
  if (c.default !== null) s += ` DEFAULT ${formatDefault(c.default)}`
  return s
}

function formatDefault(value: string): string {
  // SQL keywords/functions stay bare; everything else is treated as a literal.
  const upper = value.toUpperCase()
  if (upper === 'CURRENT_TIMESTAMP' || upper === 'NOW()') return value
  if (/^-?\d+(\.\d+)?$/.test(value)) return value // numeric
  if (value === 'true' || value === 'false') return value // boolean literal
  return quoteLiteral(value)
}
```

- [ ] **Step 15.4: Re-export** — append to `packages/db/src/index.ts`:

```ts
export { emitPg } from './emit/pg'
```

- [ ] **Step 15.5: Run — passes**.

- [ ] **Step 15.6: Commit**

```bash
git add packages/db/src/emit packages/db/src/index.ts packages/db/__tests__/unit/emit-pg-create-drop.test.ts
git commit -m "$(cat <<'EOF'
feat(db): pg emitter — CREATE/DROP/RENAME TABLE (M0-S4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: PG emit — column add/drop/alter/rename

**Story:** [`M0-S4`](./stories.md).
**Files:**

- Modify: `packages/db/src/emit/pg.ts`
- Create: `packages/db/__tests__/unit/emit-pg-columns.test.ts`

- [ ] **Step 16.1: Write the failing test**

Create `packages/db/__tests__/unit/emit-pg-columns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

const before = { name: 'age', type: 'integer', nullable: true, default: null, primaryKey: false }
const after = { name: 'age', type: 'bigint', nullable: false, default: '0', primaryKey: false }

describe('emitPg() — column changes', () => {
  it('ADD COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'addColumn',
        table: 'users',
        column: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" ADD COLUMN "email" varchar(255) NOT NULL;')
  })

  it('DROP COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'dropColumn',
        table: 'users',
        column: { name: 'legacy', type: 'text', nullable: true, default: null, primaryKey: false },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" DROP COLUMN "legacy";')
  })

  it('RENAME COLUMN', () => {
    const cs: ChangeSet = [{ kind: 'renameColumn', table: 'users', from: 'emailAddr', to: 'email' }]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" RENAME COLUMN "emailAddr" TO "email";')
  })

  it('ALTER COLUMN — type + nullable + default', () => {
    const cs: ChangeSet = [{ kind: 'alterColumn', table: 'users', column: 'age', before, after }]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint USING "age"::bigint;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET NOT NULL;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET DEFAULT 0;',
    )
  })

  it('ALTER COLUMN — drop default + drop NOT NULL', () => {
    const cs: ChangeSet = [
      {
        kind: 'alterColumn',
        table: 'users',
        column: 'age',
        before: { name: 'age', type: 'integer', nullable: false, default: '0', primaryKey: false },
        after: { name: 'age', type: 'integer', nullable: true, default: null, primaryKey: false },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" DROP DEFAULT;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" DROP NOT NULL;',
    )
  })
})
```

- [ ] **Step 16.2: Run — fails** (the M0 stub returns `-- unsupported`).

- [ ] **Step 16.3: Extend `emitPg`'s `emitChange` switch**

Replace the `default` branch and add new cases. Full updated `emitChange`:

```ts
function emitChange(change: Change): string {
  switch (change.kind) {
    case 'createTable':
      return emitCreateTable(change.table)
    case 'dropTable':
      return `DROP TABLE ${quoteIdent(change.table.name)};`
    case 'renameTable':
      return `ALTER TABLE ${quoteIdent(change.from)} RENAME TO ${quoteIdent(change.to)};`
    case 'addColumn':
      return emitAddColumn(change.table, change.column)
    case 'dropColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} DROP COLUMN ${quoteIdent(change.column.name)};`
    case 'renameColumn':
      return `ALTER TABLE ${quoteIdent(change.table)} RENAME COLUMN ${quoteIdent(change.from)} TO ${quoteIdent(change.to)};`
    case 'alterColumn':
      return emitAlterColumn(change.table, change.before, change.after)
    case 'addIndex':
      return emitAddIndex(change.table, change.index)
    case 'dropIndex':
      return `DROP INDEX ${quoteIdent(change.index.name)};`
    case 'addForeignKey':
      return emitAddFk(change.table, change.fk)
    case 'dropForeignKey':
      return `ALTER TABLE ${quoteIdent(change.table)} DROP CONSTRAINT ${quoteIdent(change.fk.name)};`
  }
}
```

Add the helpers at the bottom of the file:

```ts
function emitAddColumn(table: string, c: ColumnSnapshot): string {
  return `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${emitColumnDecl(c)};`
}

function emitAlterColumn(table: string, before: ColumnSnapshot, after: ColumnSnapshot): string {
  const stmts: string[] = []
  const t = quoteIdent(table)
  const c = quoteIdent(after.name)

  if (before.type !== after.type) {
    stmts.push(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${after.type} USING ${c}::${after.type};`)
  }
  if (before.nullable !== after.nullable) {
    stmts.push(
      `ALTER TABLE ${t} ALTER COLUMN ${c} ${after.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
    )
  }
  if (before.default !== after.default) {
    stmts.push(
      after.default === null
        ? `ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT;`
        : `ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${formatDefault(after.default)};`,
    )
  }
  return stmts.join('\n')
}
```

(The `addIndex` and `addFk` helpers are stubbed for now; Task 17 fills them with real bodies. The `case 'addIndex'` line above will route to the helper added next task. Add temporary stubs at the bottom of the file so the file compiles after this step:)

```ts
function emitAddIndex(_table: string, _i: import('../snapshot/types').IndexSnapshot): string {
  return '-- index emit: filled in Task 17'
}

function emitAddFk(_table: string, _fk: import('../snapshot/types').ForeignKeySnapshot): string {
  return '-- fk emit: filled in Task 17'
}
```

- [ ] **Step 16.4: Run — passes** (column tests).

- [ ] **Step 16.5: Commit**

```bash
git add packages/db/src/emit/pg.ts packages/db/__tests__/unit/emit-pg-columns.test.ts
git commit -m "$(cat <<'EOF'
feat(db): pg emitter — ADD/DROP/ALTER/RENAME COLUMN (M0-S4)

ALTER COLUMN emits a sequence (TYPE / NOT NULL / DEFAULT) so each clause
is independently reviewable. Index and FK emit stubbed until Task 17.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: PG emit — indexes + foreign keys + serial desugar

**Story:** [`M0-S4`](./stories.md).
**Files:**

- Modify: `packages/db/src/emit/pg.ts`
- Create: `packages/db/__tests__/unit/emit-pg-indexes-fks.test.ts`

- [ ] **Step 17.1: Write the failing test**

Create `packages/db/__tests__/unit/emit-pg-indexes-fks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

describe('emitPg() — indexes & FKs', () => {
  it('CREATE INDEX (non-unique)', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'users',
        index: { name: 'users_email_idx', columns: ['email'], unique: false },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE INDEX "users_email_idx" ON "users" ("email");')
  })

  it('CREATE UNIQUE INDEX', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'users',
        index: { name: 'users_email_unique', columns: ['email'], unique: true },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");')
  })

  it('multi-column unique', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'posts',
        index: { name: 'posts_slug', columns: ['title', 'authorId'], unique: true },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE UNIQUE INDEX "posts_slug" ON "posts" ("title", "authorId");')
  })

  it('ADD FOREIGN KEY with cascade', () => {
    const cs: ChangeSet = [
      {
        kind: 'addForeignKey',
        table: 'posts',
        fk: {
          name: 'posts_author_fk',
          columns: ['authorId'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk" ' +
        'FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
    )
  })
})
```

- [ ] **Step 17.2: Run — fails**.

- [ ] **Step 17.3: Replace stubs at the bottom of `packages/db/src/emit/pg.ts`**

```ts
function emitAddIndex(table: string, i: import('../snapshot/types').IndexSnapshot): string {
  const cols = i.columns.map(quoteIdent).join(', ')
  return `CREATE${i.unique ? ' UNIQUE' : ''} INDEX ${quoteIdent(i.name)} ON ${quoteIdent(table)} (${cols});`
}

const FK_ACTIONS: Record<string, string> = {
  cascade: 'CASCADE',
  restrict: 'RESTRICT',
  set_null: 'SET NULL',
  set_default: 'SET DEFAULT',
  no_action: 'NO ACTION',
}

function emitAddFk(table: string, fk: import('../snapshot/types').ForeignKeySnapshot): string {
  const cols = fk.columns.map(quoteIdent).join(', ')
  const refCols = fk.refColumns.map(quoteIdent).join(', ')
  return (
    `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(fk.name)} ` +
    `FOREIGN KEY (${cols}) REFERENCES ${quoteIdent(fk.refTable)} (${refCols}) ` +
    `ON DELETE ${FK_ACTIONS[fk.onDelete]} ON UPDATE ${FK_ACTIONS[fk.onUpdate]};`
  )
}
```

- [ ] **Step 17.4: Run — passes**.

- [ ] **Step 17.5: Commit**

```bash
git add packages/db/src/emit/pg.ts packages/db/__tests__/unit/emit-pg-indexes-fks.test.ts
git commit -m "$(cat <<'EOF'
feat(db): pg emitter — indexes, FKs, FK actions (M0-S4)

CREATE [UNIQUE] INDEX and ALTER TABLE ADD CONSTRAINT FOREIGN KEY,
mapping snapshot FkAction enum to PG SQL keywords.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Testcontainer integration test (M0-S5)

**Story:** [`M0-S5`](./stories.md). Apply emitted SQL against real Postgres; introspect; assert parity with target snapshot.
**Files:**

- Create: `packages/db/__tests__/integration/spike.test.ts`

- [ ] **Step 18.1: Write the integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import {
  table,
  relations,
  serial,
  integer,
  varchar,
  index,
  unique,
  extractSnapshot,
  diff,
  emitPg,
} from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const users = table(
  'users',
  {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
  }),
)

const posts = table(
  'posts',
  {
    id: serial().primaryKey(),
    authorId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar(200).notNull(),
  },
  (t) => ({
    uniqTitle: unique('posts_title_author_unique').on(t.title, t.authorId),
  }),
)

const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))

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

describe('spike — full pipeline (PG)', () => {
  it('extract → diff → emit → apply → introspect produces target schema', async () => {
    const target = extractSnapshot({ users, posts, usersRelations }, 'postgres')
    const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

    const sql = emitPg(diff(empty, target))
    await client.query(sql)

    // Verify users + posts exist
    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `)
    expect(tables.rows.map((r) => r.table_name)).toEqual(['posts', 'users'])

    // Verify users.email is varchar(255) NOT NULL
    const cols = await client.query<{
      column_name: string
      data_type: string
      is_nullable: string
      character_maximum_length: number | null
    }>(`
      SELECT column_name, data_type, is_nullable, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `)
    const email = cols.rows.find((r) => r.column_name === 'email')
    expect(email).toBeDefined()
    expect(email!.data_type).toBe('character varying')
    expect(email!.character_maximum_length).toBe(255)
    expect(email!.is_nullable).toBe('NO')

    // Verify FK posts.authorId -> users.id
    const fks = await client.query<{ constraint_name: string; on_delete: string }>(`
      SELECT tc.constraint_name, rc.delete_rule AS on_delete
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc USING (constraint_name)
      WHERE tc.table_name = 'posts' AND tc.constraint_type = 'FOREIGN KEY'
    `)
    expect(fks.rows).toHaveLength(1)
    expect(fks.rows[0].constraint_name).toBe('posts_authorId_fk')
    expect(fks.rows[0].on_delete).toBe('CASCADE')

    // Verify index users_email_idx exists
    const idxs = await client.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_idx'
    `)
    expect(idxs.rows).toHaveLength(1)
  }, 60_000)
})
```

- [ ] **Step 18.2: Run — should pass**

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS. Container start ~30s, test runs in <5s.

> **Note:** if Docker isn't running, the test fails at container start. Document in README that integration tests require Docker.

- [ ] **Step 18.3: Commit**

```bash
git add packages/db/__tests__/integration/spike.test.ts
git commit -m "$(cat <<'EOF'
test(db): full-pipeline integration test on real PG (M0-S5)

Builds the canonical 2-table schema, runs extract → diff → emit → apply
against a Testcontainers Postgres 16 instance, introspects with
information_schema/pg_indexes, and asserts table/column/FK/index parity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: `kick.config.ts` loader

**Story:** [`M0-S6`](./stories.md) — minimal config reader for the CLI.
**Files:**

- Create: `packages/db/src/cli/config.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/unit/cli-config.test.ts`
- Create: `packages/db/__tests__/fixtures/kick.config.demo.ts`

- [ ] **Step 19.1: Create fixture `packages/db/__tests__/fixtures/kick.config.demo.ts`**

```ts
export default {
  db: {
    schemaPath: './packages/db/__tests__/fixtures/schema.demo.ts',
    migrationsDir: './packages/db/__tests__/fixtures/migrations',
    dialect: 'postgres' as const,
  },
}
```

- [ ] **Step 19.2: Write the failing test**

Create `packages/db/__tests__/unit/cli-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveDbConfig } from '../../src/cli/config'

describe('resolveDbConfig', () => {
  it('reads schemaPath/migrationsDir/dialect from config', async () => {
    const cfg = await resolveDbConfig({
      configPath: './packages/db/__tests__/fixtures/kick.config.demo.ts',
    })
    expect(cfg).toEqual({
      schemaPath: './packages/db/__tests__/fixtures/schema.demo.ts',
      migrationsDir: './packages/db/__tests__/fixtures/migrations',
      dialect: 'postgres',
    })
  })

  it('returns sensible defaults when absent', async () => {
    const cfg = await resolveDbConfig({
      configPath: './packages/db/__tests__/fixtures/kick.config.empty.ts',
    })
    expect(cfg.dialect).toBe('postgres')
    expect(cfg.schemaPath).toBe('src/db/schema.ts')
    expect(cfg.migrationsDir).toBe('db/migrations')
  })
})
```

Also create `packages/db/__tests__/fixtures/kick.config.empty.ts`:

```ts
export default {}
```

- [ ] **Step 19.3: Run — fails**.

- [ ] **Step 19.4: Create `packages/db/src/cli/config.ts`**

```ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Dialect } from '../snapshot/types'

export interface DbConfig {
  schemaPath: string
  migrationsDir: string
  dialect: Dialect
}

export async function resolveDbConfig(opts: { configPath: string }): Promise<DbConfig> {
  const abs = path.resolve(opts.configPath)
  const mod = await import(pathToFileURL(abs).href)
  const cfg = mod.default ?? mod
  const db = cfg?.db ?? {}
  return {
    schemaPath: db.schemaPath ?? 'src/db/schema.ts',
    migrationsDir: db.migrationsDir ?? 'db/migrations',
    dialect: db.dialect ?? 'postgres',
  }
}
```

- [ ] **Step 19.5: Re-export** — append to `packages/db/src/index.ts`:

```ts
export { resolveDbConfig, type DbConfig } from './cli/config'
```

- [ ] **Step 19.6: Run — passes**.

- [ ] **Step 19.7: Commit**

```bash
git add packages/db/src/cli packages/db/src/index.ts packages/db/__tests__/unit/cli-config.test.ts packages/db/__tests__/fixtures
git commit -m "$(cat <<'EOF'
feat(db): add resolveDbConfig() loading kick.config.ts (M0-S6)

Reads db.schemaPath / db.migrationsDir / db.dialect with defaults.
Uses dynamic import + pathToFileURL for ESM compat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: `generate` command core — schema load + diff + emit + write files

**Story:** [`M0-S6`](./stories.md).
**Files:**

- Create: `packages/db/src/cli/generate.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/__tests__/fixtures/schema.demo.ts`

- [ ] **Step 20.1: Create demo schema `packages/db/__tests__/fixtures/schema.demo.ts`**

```ts
import { table, serial, varchar } from '../../src/index'

export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})
```

- [ ] **Step 20.2: Create `packages/db/src/cli/generate.ts`**

```ts
import path from 'node:path'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

import { extractSnapshot } from '../snapshot/extract'
import { diff } from '../diff/engine'
import { emitPg } from '../emit/pg'
import type { DbConfig } from './config'
import type { SchemaSnapshot } from '../snapshot/types'

export interface GenerateOptions {
  name: string
  config: DbConfig
  cwd: string
  now?: () => Date
}

export interface GenerateResult {
  status: 'created' | 'no-changes'
  migrationDir?: string
  changeCount: number
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const schemaAbs = path.resolve(opts.cwd, opts.config.schemaPath)
  const migrationsAbs = path.resolve(opts.cwd, opts.config.migrationsDir)

  const schemaModule = await import(pathToFileURL(schemaAbs).href)
  const target = extractSnapshot(schemaModule, opts.config.dialect)

  const prev = await readLatestSnapshot(migrationsAbs)
  const changes = diff(prev, target)

  if (changes.length === 0) {
    return { status: 'no-changes', changeCount: 0 }
  }

  const id = formatId(opts.now?.() ?? new Date(), opts.name)
  const dir = path.join(migrationsAbs, id)
  await mkdir(dir, { recursive: true })

  const upSql = '-- REVIEWED: false\n' + emitPg(changes) + '\n'
  await writeFile(path.join(dir, 'up.sql'), upSql, 'utf8')
  await writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(target, null, 2) + '\n', 'utf8')
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        id,
        name: opts.name,
        createdAt: (opts.now?.() ?? new Date()).toISOString(),
        reviewed: false,
        dialect: opts.config.dialect,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  return { status: 'created', migrationDir: dir, changeCount: changes.length }
}

async function readLatestSnapshot(migrationsDir: string): Promise<SchemaSnapshot> {
  if (!existsSync(migrationsDir)) {
    return { version: 1, dialect: 'postgres', tables: {} }
  }
  const entries = await readdir(migrationsDir)
  const dirs = entries.filter((e) => /^\d{8}_\d{6}_/.test(e)).sort()
  if (dirs.length === 0) {
    return { version: 1, dialect: 'postgres', tables: {} }
  }
  const latest = dirs[dirs.length - 1]
  const file = path.join(migrationsDir, latest, 'snapshot.json')
  return JSON.parse(await readFile(file, 'utf8')) as SchemaSnapshot
}

function formatId(date: Date, name: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const ts =
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    '_' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  const slug = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  return `${ts}_${slug}`
}
```

- [ ] **Step 20.3: Re-export** — append to `packages/db/src/index.ts`:

```ts
export { generate } from './cli/generate'
export type { GenerateOptions, GenerateResult } from './cli/generate'
```

- [ ] **Step 20.4: Verify typecheck**

```bash
pnpm --filter @forinda/kickjs-db typecheck
```

Expected: exit 0.

- [ ] **Step 20.5: Commit**

```bash
git add packages/db/src/cli/generate.ts packages/db/src/index.ts packages/db/__tests__/fixtures/schema.demo.ts
git commit -m "$(cat <<'EOF'
feat(db): add generate() — schema load → diff → emit → write (M0-S6)

Reads previous snapshot from latest migration dir, diffs against the
extracted target, emits up.sql/snapshot.json/meta.json into a
timestamped folder. up.sql header is -- REVIEWED: false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: `generate` end-to-end test

**Story:** [`M0-S6`](./stories.md). Round-trip: empty migrations dir → run generate → verify files → run again → "no changes".
**Files:**

- Create: `packages/db/__tests__/unit/cli-generate.test.ts`

- [ ] **Step 21.1: Write the test**

Create `packages/db/__tests__/unit/cli-generate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { generate } from '@forinda/kickjs-db'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-gen-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('generate()', () => {
  it('creates a migration on first run', async () => {
    const cfg = {
      schemaPath: path.resolve('packages/db/__tests__/fixtures/schema.demo.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const fixed = new Date(Date.UTC(2026, 3, 27, 15, 30, 12))
    const r = await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => fixed })

    expect(r.status).toBe('created')
    expect(r.changeCount).toBe(1)

    const subdirs = await readdir(cfg.migrationsDir)
    expect(subdirs).toEqual(['20260427_153012_init'])

    const upSql = await readFile(path.join(cfg.migrationsDir, subdirs[0], 'up.sql'), 'utf8')
    expect(upSql.startsWith('-- REVIEWED: false\n')).toBe(true)
    expect(upSql).toContain('CREATE TABLE "users"')
    expect(upSql).toContain('CREATE UNIQUE INDEX "users_email_unique"')

    const meta = JSON.parse(
      await readFile(path.join(cfg.migrationsDir, subdirs[0], 'meta.json'), 'utf8'),
    )
    expect(meta).toMatchObject({ id: '20260427_153012_init', reviewed: false, dialect: 'postgres' })
  })

  it('returns no-changes when re-run against the same schema', async () => {
    const cfg = {
      schemaPath: path.resolve('packages/db/__tests__/fixtures/schema.demo.ts'),
      migrationsDir: path.join(dir, 'migrations'),
      dialect: 'postgres' as const,
    }
    const t1 = new Date(Date.UTC(2026, 3, 27, 15, 30, 12))
    const t2 = new Date(Date.UTC(2026, 3, 27, 16, 0, 0))

    await generate({ name: 'init', config: cfg, cwd: process.cwd(), now: () => t1 })
    const r2 = await generate({ name: 'init2', config: cfg, cwd: process.cwd(), now: () => t2 })

    expect(r2.status).toBe('no-changes')
    expect(r2.changeCount).toBe(0)
  })
})
```

- [ ] **Step 21.2: Run — passes**.

```bash
pnpm --filter @forinda/kickjs-db test
```

Expected: PASS.

- [ ] **Step 21.3: Commit**

```bash
git add packages/db/__tests__/unit/cli-generate.test.ts
git commit -m "$(cat <<'EOF'
test(db): generate() end-to-end (M0-S6)

First run creates a timestamped migration dir with up.sql + snapshot.json
+ meta.json. Re-run returns no-changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Wire `kick db generate` into `@forinda/kickjs-cli`

**Story:** [`M0-S6`](./stories.md) — surface the command on the existing CLI.
**Files:**

- Modify: `packages/cli/package.json` (add `@forinda/kickjs-db` workspace dep)
- Create: `packages/cli/src/commands/db.ts`
- Modify: `packages/cli/src/cli.ts` (register the command)

> **Read first:** the existing `packages/cli/src/cli.ts` and one existing command (e.g. `generate.ts`) to confirm the registration pattern (Commander.js subcommand, command builder, etc). The pattern below is plausible but verify against the file before pasting.

- [ ] **Step 22.1: Read the existing CLI registration shape**

```bash
sed -n '1,40p' packages/cli/src/cli.ts
ls packages/cli/src/commands/
```

Note the pattern — file may use `commander`, `cac`, or a custom parser. The snippet below assumes commander; adjust to match.

- [ ] **Step 22.2: Add the workspace dep to `packages/cli/package.json`**

In the `dependencies` block, add:

```json
"@forinda/kickjs-db": "workspace:*"
```

Then run:

```bash
pnpm install
```

- [ ] **Step 22.3: Create `packages/cli/src/commands/db.ts`**

```ts
import path from 'node:path'
import { Command } from 'commander'

import { generate, resolveDbConfig } from '@forinda/kickjs-db'

export function registerDbCommands(program: Command) {
  const db = program.command('db').description('Database commands (kickjs-db)')

  db.command('generate <name>')
    .description('Generate a new migration from schema diff')
    .option('-c, --config <path>', 'Path to kick.config.ts', 'kick.config.ts')
    .action(async (name: string, opts: { config: string }) => {
      const cwd = process.cwd()
      const config = await resolveDbConfig({ configPath: path.resolve(cwd, opts.config) })
      const result = await generate({ name, config, cwd })

      if (result.status === 'no-changes') {
        console.log('No schema changes detected.')
        return
      }
      console.log(
        `Created migration ${result.migrationDir} (${result.changeCount} change${result.changeCount === 1 ? '' : 's'}).`,
      )
    })
}
```

- [ ] **Step 22.4: Wire into `packages/cli/src/cli.ts`**

Open `packages/cli/src/cli.ts` and add (near other command registrations):

```ts
import { registerDbCommands } from './commands/db'
// ... after `program` is created and other commands registered:
registerDbCommands(program)
```

> If the file uses a different framework, adapt the registration to match. The semantic — register a `db` subcommand with `generate` — is what matters.

- [ ] **Step 22.5: Build the CLI**

```bash
pnpm --filter @forinda/kickjs-cli build
pnpm --filter @forinda/kickjs-db build
```

Expected: exit 0.

- [ ] **Step 22.6: Smoke-test the CLI in a temp dir**

Create a one-off scratch script (do not commit):

```bash
mkdir -p /tmp/kickdb-spike && cd /tmp/kickdb-spike
cat > kick.config.ts <<'EOF'
export default {
  db: {
    schemaPath: 'src/db/schema.ts',
    migrationsDir: 'db/migrations',
    dialect: 'postgres' as const,
  },
}
EOF
mkdir -p src/db
cat > src/db/schema.ts <<'EOF'
import { table, serial, varchar } from '@forinda/kickjs-db'
export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
})
EOF
node /home/forinda/dev/open-source/kick-js/packages/cli/bin.js db generate init
ls -la db/migrations/*/
cat db/migrations/*/up.sql
```

Expected: `db/migrations/<timestamp>_init/up.sql` exists, starts with `-- REVIEWED: false`, contains `CREATE TABLE "users"`.

- [ ] **Step 22.7: Clean up the scratch dir**

```bash
rm -rf /tmp/kickdb-spike
```

- [ ] **Step 22.8: Commit**

```bash
git add packages/cli/package.json packages/cli/src/commands/db.ts packages/cli/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(cli): register kick db generate command (M0-S6)

Wires @forinda/kickjs-db's generate() into the existing CLI shell.
First end-to-end usable surface for the spike.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M0 exit gate

After Task 22, run the full verification suite from repo root:

```bash
pnpm build
pnpm test
pnpm format:check
```

Expected: all green. The pipeline is proven:

1. Write a TS schema → `extractSnapshot` → JSON IR.
2. Compare to last snapshot → `diff` → ChangeSet.
3. Compile → `emitPg` → SQL.
4. Apply via `pg.Client` → real PG state matches the schema.
5. CLI: `kick db generate <name>` writes the migration files with `-- REVIEWED: false` header.

Ready for M1 (down emit + journal + lock + runner + Kysely client).

---

## Plan self-review notes

Spec coverage check (against [`./architecture.md`](./architecture.md) and [`./stories.md`](./stories.md)):

- M0-S1 — covered by Task 2.
- M0-S2 — covered by Tasks 3, 4, 5, 6, 7.
- M0-S3 — covered by Tasks 8, 9, 10, 11, 12, 13.
- M0-S4 — covered by Tasks 14, 15, 16, 17.
- M0-S5 — covered by Task 18.
- M0-S6 — covered by Tasks 19, 20, 21, 22.

Type consistency: `SchemaSnapshot`, `ColumnSnapshot`, `IndexSnapshot`, `ForeignKeySnapshot`, `Change`, `ChangeSet` defined in Task 2 / Task 8; consumed identically in Tasks 7, 9–13, 15–17, 18, 20. No naming drift.

Placeholders: none — every code block is complete.

Out of scope for M0 (deferred to M1):

- Down emission (`-- REVIEWED: false` header on `up.sql` only; `down.sql` lands in M1-S2).
- Journal (`_journal.json`) — M1-S3.
- Lock + tracking tables — M1-S4.
- Runner (`migrate latest|up|down|rollback|status`) — M1-S5.
- Drift detection — M1-S6.
- Kysely client — M1-S7, M1-S8.
- DI tokens — M1-S9.
- Example app port — M1-S10.

---

**Plan complete and saved to `docs/db/m0-spike-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session, batch with checkpoints for review.

**Which approach?**
