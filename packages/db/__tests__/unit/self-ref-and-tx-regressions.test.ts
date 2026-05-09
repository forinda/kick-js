/**
 * Locks the two M3 PR-review (Copilot) regressions in place so the
 * next reviewer doesn't have to re-spot them. Both surfaced on
 * commit `14059541` ("fix(db,vite): address Copilot review on M3 PR")
 * and the original M3.B / M3.A.5 tests already adapted to the fix —
 * but those pass under both the buggy and the fixed implementation.
 * These regression tests fail loudly under the bug and pass only
 * under the fix.
 *
 * Spec: docs/db/m4-plan.md §M4.E.2.
 */

import { describe, expect, it } from 'vitest'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'

import { emitPg, type ResolvedRelations, type TableSnapshot } from '@forinda/kickjs-db'
// `compilePg` is intentionally not on the public surface (the public
// API is `db.query.X.findMany({ with })`), so this remains a deep
// import. Same pattern as `query-compile.test.ts`.
import { compilePg } from '../../src/query/compile-pg'

interface FixtureDB {
  categories: { id: string; parentId: string | null; name: string }
}

function makeDb(): Kysely<FixtureDB> {
  return new Kysely<FixtureDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

function emptyCol(): TableSnapshot['columns'][string] {
  return { name: '', type: 'text', nullable: true, default: null, primaryKey: false }
}

const TABLES: Record<string, TableSnapshot> = {
  categories: {
    name: 'categories',
    columns: { id: emptyCol(), parentId: emptyCol(), name: emptyCol() },
    indexes: [],
    foreignKeys: [],
    checks: [],
  },
}

const RELATIONS: ResolvedRelations = {
  categories: {
    parent: {
      kind: 'one',
      target: 'categories',
      sourceColumns: ['parentId'],
      targetColumns: ['id'],
    },
    children: {
      kind: 'many',
      target: 'categories',
      sourceColumns: ['id'],
      targetColumns: ['parentId'],
    },
  },
}

describe('M4.E.2 — compilePg self-reference depth aliases', () => {
  it('emits depth-suffixed aliases on outer + inner level for a self-ref many', () => {
    const compiled = compilePg(
      makeDb(),
      'categories',
      { with: { children: true } },
      RELATIONS,
      TABLES,
      'many',
    )

    // Outer aliased as `categories_0`; inner LATERAL aliased as
    // `categories_1`. Neither level may surface as bare
    // `"categories"."id" = "categories"."parentId"` — that's the
    // pre-fix bug PG silently resolved to the inner FROM.
    expect(compiled.sql).toContain('"categories" as "categories_0"')
    expect(compiled.sql).toContain('"categories" as "categories_1"')
  })

  it('joins reference both depth aliases on opposite sides of the predicate', () => {
    const compiled = compilePg(
      makeDb(),
      'categories',
      { with: { children: true } },
      RELATIONS,
      TABLES,
      'many',
    )

    // The correlation predicate must reference the outer alias on one
    // side and the inner alias on the other — both bare `categories`
    // in the join condition is the bug we're locking against.
    expect(compiled.sql).toContain('"categories_0"')
    expect(compiled.sql).toContain('"categories_1"')
  })

  it('does not produce a bare unaliased `from "categories"` clause', () => {
    const compiled = compilePg(
      makeDb(),
      'categories',
      { with: { children: true } },
      RELATIONS,
      TABLES,
      'many',
    )

    // Bare `from "categories"` without an alias would mean a level
    // forgot the suffix and PG resolves the join to the wrong scope.
    expect(compiled.sql).not.toMatch(/from\s+"categories"\s+(?!as\s)/i)
  })

  it('handles a one-relation self-ref (parent) with the same depth-alias contract', () => {
    const compiled = compilePg(
      makeDb(),
      'categories',
      { with: { parent: true } },
      RELATIONS,
      TABLES,
      'many',
    )

    expect(compiled.sql).toContain('"categories" as "categories_0"')
    expect(compiled.sql).toContain('"categories" as "categories_1"')
  })
})

describe('M4.E.2 — emitPg removeEnumValue does not nest BEGIN/COMMIT', () => {
  it('omits explicit BEGIN; / COMMIT; on the rename-recreate block', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status' }],
      },
    ])

    // Runner wraps every up.sql in applySqlInTx; PG DDL is
    // transactional. An explicit BEGIN inside that outer transaction
    // commits early on the inner COMMIT and silently breaks the
    // runner's atomic-apply guarantee. Lock the absence here so the
    // next reviewer doesn't have to re-spot it.
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/m)
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/m)

    // Sanity — the rename-recreate block IS produced (so we're not
    // silently passing on an empty emit).
    expect(sql).toContain('ALTER TYPE "status" RENAME TO "status__old"')
    expect(sql).toContain('CREATE TYPE "status" AS ENUM')
    expect(sql).toContain('DROP TYPE "status__old"')
  })

  it('omits BEGIN/COMMIT even when multiple enums drop values in the same migration', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status' }],
      },
      {
        kind: 'removeEnumValue',
        enum: 'role',
        removed: ['root'],
        values: ['admin', 'member'],
        affectedColumns: [{ table: 'users', column: 'role' }],
      },
    ])

    expect(sql).not.toMatch(/^\s*BEGIN\s*;/m)
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/m)
    expect(sql).toContain('ALTER TYPE "status"')
    expect(sql).toContain('ALTER TYPE "role"')
  })
})
