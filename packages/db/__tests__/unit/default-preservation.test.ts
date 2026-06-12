/**
 * M5.A.1 — column DEFAULT preservation through pgEnum rename-recreate.
 *
 * Pure-emit + pure-diff tests against the new
 * `affectedColumns[i].default` field. The Testcontainers integration
 * test (enum-drop-with-default.test.ts) covers the live-PG round trip;
 * these tests just lock the SQL string output + the diff-time guard.
 *
 * Spec: docs/db/spec-default-preservation.md.
 */

import { describe, expect, it } from 'vitest'

import {
  diff,
  emitPg,
  extractSnapshot,
  RemovedValueAsDefaultError,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'
import { pgEnum } from '@forinda/kickjs-db/pg'
import { table, serial, varchar } from '@forinda/kickjs-db'

describe('M5.A.1 — emitRemoveEnumValueRecreate with column DEFAULTs', () => {
  it('wraps the type swap in DROP/SET DEFAULT brackets when default is non-null', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status', default: `'active'::"status"` }],
      },
    ])

    // DROP DEFAULT precedes the swap; SET DEFAULT follows it. The
    // `::"status"` cast is recomputed against the freshly-created
    // type so we don't double-cast through the renamed shadow.
    expect(sql).toMatch(
      /ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;[\s\S]*?ALTER TABLE "users"\s+ALTER COLUMN "status" TYPE "status"\s+USING "status"::text::"status";\s*ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active'::"status";/,
    )
  })

  it('omits the brackets when default is null (byte-identical to pre-M5.A.1 output)', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status', default: null }],
      },
    ])

    expect(sql).not.toContain('DROP DEFAULT')
    expect(sql).not.toContain('SET DEFAULT')
    expect(sql).toContain(`ALTER COLUMN "status" TYPE "status"`)
  })

  it('preserves declaration order across mixed default/no-default columns', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [
          { table: 'users', column: 'status', default: `'active'::"status"` },
          { table: 'audit_log', column: 'action', default: null },
        ],
      },
    ])

    const usersDrop = sql.indexOf(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`)
    const auditSwap = sql.indexOf(`ALTER TABLE "audit_log"`)
    expect(usersDrop).toBeGreaterThan(-1)
    expect(auditSwap).toBeGreaterThan(usersDrop) // declaration order preserved

    // The audit-log column had no default, so no DROP/SET around it.
    const auditBlock = sql.slice(auditSwap)
    expect(auditBlock).not.toContain(`ALTER COLUMN "action" DROP DEFAULT`)
    expect(auditBlock).not.toContain(`ALTER COLUMN "action" SET DEFAULT`)
  })

  it('strips an existing PG cast off the default before re-attaching the new type', () => {
    // Spec edge case — the prior snapshot's default carries a
    // `::"status"` cast (the shadow type after RENAME). The emitter
    // must not produce `'active'::"status"::"status"`.
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status', default: `'active'::"status"` }],
      },
    ])

    expect(sql).toContain(`SET DEFAULT 'active'::"status";`)
    expect(sql).not.toContain(`::"status"::"status"`)
  })

  it('passes function-call defaults through verbatim', () => {
    const sql = emitPg([
      {
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['legacy'],
        values: ['active', 'banned'],
        affectedColumns: [{ table: 'users', column: 'status', default: 'compute_default()' }],
      },
    ])

    // No cast is in the prior snapshot, so the emitter just emits
    // `SET DEFAULT compute_default()::"status"` — PG accepts this if
    // the function returns a text-castable value.
    expect(sql).toContain(`SET DEFAULT compute_default()::"status";`)
  })
})

describe('M5.A.1 — diff guard against removed-value-as-default', () => {
  function snapshotWith(opts: {
    enumValues: string[]
    columnDefault: string | null
  }): SchemaSnapshot {
    return {
      version: 1,
      dialect: 'postgres',
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            status: {
              name: 'status',
              type: 'status',
              nullable: false,
              default: opts.columnDefault,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
      enums: { status: { name: 'status', values: opts.enumValues } },
    }
  }

  it('throws RemovedValueAsDefaultError when the column default is being dropped from the enum', () => {
    const prev = snapshotWith({
      enumValues: ['active', 'banned', 'legacy'],
      columnDefault: `'legacy'::"status"`,
    })
    const next = snapshotWith({
      enumValues: ['active', 'banned'],
      columnDefault: `'legacy'::"status"`,
    })

    expect(() => diff(prev, next)).toThrow(RemovedValueAsDefaultError)

    try {
      diff(prev, next)
    } catch (err) {
      expect(err).toBeInstanceOf(RemovedValueAsDefaultError)
      const e = err as RemovedValueAsDefaultError
      expect(e.code).toBe('removed_value_as_default')
      expect(e.enum).toBe('status')
      expect(e.table).toBe('users')
      expect(e.column).toBe('status')
      expect(e.value).toBe('legacy')
    }
  })

  it('does NOT throw when the default is one of the surviving values', () => {
    const prev = snapshotWith({
      enumValues: ['active', 'banned', 'legacy'],
      columnDefault: `'active'::"status"`,
    })
    const next = snapshotWith({
      enumValues: ['active', 'banned'],
      columnDefault: `'active'::"status"`,
    })

    const changes = diff(prev, next)
    const removeChange = changes.find(
      (c): c is Extract<(typeof changes)[number], { kind: 'removeEnumValue' }> =>
        c.kind === 'removeEnumValue',
    )
    expect(removeChange).toBeDefined()
    expect(removeChange?.affectedColumns[0]?.default).toBe(`'active'::"status"`)
  })

  it('does NOT throw when the column has no default', () => {
    const prev = snapshotWith({
      enumValues: ['active', 'banned', 'legacy'],
      columnDefault: null,
    })
    const next = snapshotWith({ enumValues: ['active', 'banned'], columnDefault: null })

    expect(() => diff(prev, next)).not.toThrow()
  })

  it('passes the default field through to RemoveEnumValue.affectedColumns', () => {
    const prev = snapshotWith({
      enumValues: ['active', 'banned', 'legacy'],
      columnDefault: `'active'::"status"`,
    })
    const next = snapshotWith({
      enumValues: ['active', 'banned'],
      columnDefault: `'active'::"status"`,
    })

    const changes = diff(prev, next)
    const removeChange = changes.find((c) => c.kind === 'removeEnumValue')
    expect(removeChange).toBeDefined()
    const affected = (removeChange as { affectedColumns: readonly { default: string | null }[] })
      .affectedColumns
    expect(affected[0]?.default).toBe(`'active'::"status"`)
  })
})

describe('M5.A.1 — extractSnapshot integration', () => {
  it('round-trips column DEFAULT through a real schema → snapshot pass', () => {
    const status = pgEnum('status', 'active', 'banned')
    const users = table('users', {
      id: serial().primaryKey(),
      // Force the schema to declare a literal default, then verify
      // it survives extraction. The exact serialisation depends on
      // the DSL's `.default()` semantics — we just lock that
      // SOMETHING non-null lands in the snapshot.
      status: varchar(20).notNull().default('active'),
    })
    void status
    const snap = extractSnapshot({ status, users }, 'postgres')
    expect(snap.tables.users.columns.status.default).not.toBeNull()
  })
})
