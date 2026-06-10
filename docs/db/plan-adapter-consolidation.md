# Plan — consolidate `db-pg` / `db-sqlite` / `db-mysql` into `@forinda/kickjs-db` subpaths

> Status: proposal for review
> Pattern source: `@forinda/kickjs-schema` (`./zod` `./valibot` `./yup` + optional peer deps)

## Goal

Adopters install **one** package + the single driver they use, instead of `@forinda/kickjs-db` **plus** `@forinda/kickjs-db-pg` **plus** `pg`. Mirror the `kickjs-schema` model: one package, per-dialect subpath adapters, drivers as **optional peer deps**, mapped through a common interface.

The common interface already exists in core — `MigrationAdapter` + Kysely `Dialect` — exactly the role `KickSchema` plays in schema. We are only relocating the per-driver implementations into subpaths.

## Before → after

| Today | After |
| --- | --- |
| `npm i @forinda/kickjs-db @forinda/kickjs-db-pg pg` | `npm i @forinda/kickjs-db pg` |
| `import { pgAdapter } from '@forinda/kickjs-db-pg'` | `import { pgAdapter } from '@forinda/kickjs-db/pg'` |
| 3 published packages (lockstep) | 0 extra packages; 3 subpaths |
| driver = peer of the sub-package | driver = **optional** peer of `@forinda/kickjs-db` |

`@forinda/kickjs-db/pg` already exists today as the **PG column types** (`tsvector`, `vector`, `citext`, …). The adapter folds into the **same** subpath, so `@forinda/kickjs-db/pg` becomes "everything PG-specific": column types **+** `pgAdapter` **+** `pgDialect`. Same for `/sqlite` and `/mysql`.

## Surface being moved

| From package | Exports | Driver peer |
| --- | --- | --- |
| `@forinda/kickjs-db-pg` | `pgAdapter`, `pgDialect`, `PgAdapterOptions`, `PgPoolLike`, `PgClientLike`, `PgDialectOptions` | `pg >=8.11` |
| `@forinda/kickjs-db-sqlite` | `sqliteAdapter`, `sqliteDialect`, `SqliteAdapterOptions`, `SqliteDatabaseLike`, `SqliteStatement`, `SqliteDialectOptions` | `better-sqlite3 >=12` |
| `@forinda/kickjs-db-mysql` | `mysqlAdapter`, `mysqlDialect`, `MysqlAdapterOptions`, `MysqlDialectOptions` | `mysql2 >=3` |

All three already depend only on `kysely` (already a dep of core) + their driver + the core `MigrationAdapter` interface. No logic rewrite.

## Steps

### 1. Relocate sources into core
- `packages/db-pg/src/{adapter,dialect}.ts` → `packages/db/src/adapters/pg/{adapter,dialect}.ts`
- `packages/db-sqlite/src/{adapter,dialect}.ts` → `packages/db/src/adapters/sqlite/{adapter,dialect}.ts`
- `packages/db-mysql/src/{adapter,dialect}.ts` → `packages/db/src/adapters/mysql/{adapter,dialect}.ts`
- Fix internal imports: `from '../adapter'` (core `MigrationAdapter`) → `from '../../migrate/adapter'` etc. (relative within core).

### 2. Subpath barrels
- `packages/db/src/pg.ts` (the existing `/pg` entry) becomes a barrel:
  ```ts
  export * from './dsl/columns/pg'      // existing PG column types
  export * from './adapters/pg/adapter' // pgAdapter
  export * from './adapters/pg/dialect' // pgDialect
  ```
- New `packages/db/src/sqlite.ts` and `packages/db/src/mysql.ts` barrels (column quirks, if any, + adapter + dialect).

### 3. Build + exports (`packages/db`)
- `tsdown.config.ts` `entry`: add `sqlite: 'src/sqlite.ts'`, `mysql: 'src/mysql.ts'` (`pg` already present). Add `pg`/`better-sqlite3`/`mysql2` to `external`.
- `package.json` `exports`: add `./sqlite`, `./mysql` (pattern matches existing `./pg`).
- `package.json`: add optional peer deps
  ```jsonc
  "peerDependencies": { "pg": ">=8.11.0", "better-sqlite3": ">=12.0.0", "mysql2": ">=3.0.0", ...existing },
  "peerDependenciesMeta": { "pg": {"optional": true}, "better-sqlite3": {"optional": true}, "mysql2": {"optional": true}, ...existing }
  ```
- Add `@types/pg`, `@types/better-sqlite3`, `better-sqlite3`, `pg`, `mysql2` to **devDependencies** so the moved code typechecks + tests run.

### 4. Deprecated shim packages (keep, per decision)
Each old package becomes a 2-line re-export + deprecation:
```ts
// packages/db-pg/src/index.ts
/** @deprecated Import from `@forinda/kickjs-db/pg` instead. */
export * from '@forinda/kickjs-db/pg'
```
- Drop the driver from its `peerDependencies` (now optional-peer on core), keep `@forinda/kickjs-db` peer.
- Add a `console.warn` once-per-process deprecation in the shim entry (optional).
- README note: "merged into `@forinda/kickjs-db/<dialect>`".

### 5. CLI
- `commands/db.ts:78` — `import('@forinda/kickjs-db-pg')` → `import('@forinda/kickjs-db/pg')`; keep the `import('pg')` probe. Update the comment.
- `commands/add.ts:80` — registry entry: `kick add pg` should now add `@forinda/kickjs-db` + `pg` (driver), not `@forinda/kickjs-db-pg`. Revisit the whole db row set: `kick add db` (core), and `pg`/`sqlite`/`mysql` add the matching driver.
- `package.json` devDep `@forinda/kickjs-db-pg` → `@forinda/kickjs-db` (already present) — drop the sub-package devDep.

### 6. Example (`examples/typegen-test`)
- `kick.config.ts`: `import { sqliteAdapter } from '@forinda/kickjs-db-sqlite'` → `from '@forinda/kickjs-db/sqlite'`.
- `package.json`: drop `@forinda/kickjs-db-sqlite`, keep `@forinda/kickjs-db` + `better-sqlite3`.

### 7. Docs
- `architecture.md §3` already describes subpath exports — update to state adapters live there too (not separate packages); fix the "Package topology" tree.
- API sidebar (`docs/.vitepress/config.mts`): the Packages group lists `@forinda/kickjs-db-pg/-sqlite/-mysql`? (it does **not** today — only `db`, `db-pg`, `db-sqlite`, `db-mysql` API pages exist). Decide: keep the `/api/db-*` pages as adapter reference, or fold into `/api/db` with subpath sections.
- Database guide `drivers.md`: update install + import lines to the subpath form.

### 8. Changeset
- `@forinda/kickjs-db`: **minor** (new subpaths + optional peers).
- `@forinda/kickjs-db-pg` / `-sqlite` / `-mysql`: **major** (now deprecated shims) — or patch if we treat the re-export as non-breaking (imports still resolve). Lean: **minor** + deprecation notice, since the public API is unchanged for existing importers.

## Risks / call-outs
- **Optional peer = no auto-install.** Adopters must install the driver themselves; the subpath throws a clear "install `pg`" error if missing (add a friendly guard at the top of each adapter, like schema's detect try/catch).
- **`kysely` stays a hard dep** of core (already is) — fine, it's the typed core for every dialect.
- **Testcontainers / better-sqlite3 native build** move into the core package's test matrix (they already run in the sub-packages).
- **`@forinda/kickjs-db/pg` dual meaning** (column types + adapter) is intentional and matches the spec, but worth a one-line note in the guide so people aren't surprised the adapter lives next to the column types.
- Lockstep versioning: the shims still version-lockstep with core.

## Rough size
Mechanical move + barrels + exports + optional peers + CLI 2-line + example + docs. No algorithm changes. ~1 focused PR; the only thinking is the `kick add` driver-row redesign and the changeset bump call.
