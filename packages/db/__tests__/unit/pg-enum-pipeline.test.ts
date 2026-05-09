import { describe, it, expect } from 'vitest'

import { table, uuid } from '../../src/index'
import { pgEnum } from '../../src/dsl/columns/pg'
import { extractSnapshot } from '../../src/snapshot/extract'
import { diff } from '../../src/diff/engine'
import { hasAmbiguousReverse, invertChanges } from '../../src/diff/invert'
import { emitPg } from '../../src/emit/pg'

describe('pgEnum snapshot + diff + emit pipeline', () => {
  it('extractSnapshot picks up pgEnum factories on PG dialect', () => {
    const role = pgEnum('role', 'admin', 'user')
    const status = pgEnum('task_status', 'todo', 'in_progress', 'done')
    const users = table('users', {
      id: uuid().primaryKey().defaultRandom(),
      role: role().notNull(),
    })
    const snap = extractSnapshot({ role, status, users }, 'postgres')
    expect(snap.enums).toBeDefined()
    expect(snap.enums!.role).toEqual({ name: 'role', values: ['admin', 'user'] })
    expect(snap.enums!.task_status).toEqual({
      name: 'task_status',
      values: ['todo', 'in_progress', 'done'],
    })
  })

  it('extractSnapshot omits enums on non-PG dialects', () => {
    const role = pgEnum('role', 'admin', 'user')
    const snap = extractSnapshot({ role }, 'sqlite')
    expect(snap.enums).toBeUndefined()
  })

  it('diff emits createEnum for new enum types BEFORE table creation', () => {
    const role = pgEnum('role', 'admin', 'user')
    const users = table('users', {
      id: uuid().primaryKey(),
      role: role().notNull(),
    })
    const prev = extractSnapshot({}, 'postgres')
    const next = extractSnapshot({ role, users }, 'postgres')
    const changes = diff(prev, next)
    const kinds = changes.map((c) => c.kind)
    const enumIdx = kinds.indexOf('createEnum')
    const tableIdx = kinds.indexOf('createTable')
    expect(enumIdx).toBeGreaterThanOrEqual(0)
    expect(tableIdx).toBeGreaterThanOrEqual(0)
    expect(enumIdx).toBeLessThan(tableIdx)
  })

  it('diff emits dropEnum AFTER table drops so dependent columns are gone first', () => {
    const role = pgEnum('role', 'admin', 'user')
    const users = table('users', {
      id: uuid().primaryKey(),
      role: role().notNull(),
    })
    const prev = extractSnapshot({ role, users }, 'postgres')
    const next = extractSnapshot({}, 'postgres')
    const changes = diff(prev, next)
    const kinds = changes.map((c) => c.kind)
    const dropTable = kinds.indexOf('dropTable')
    const dropEnum = kinds.indexOf('dropEnum')
    expect(dropTable).toBeGreaterThanOrEqual(0)
    expect(dropEnum).toBeGreaterThanOrEqual(0)
    expect(dropTable).toBeLessThan(dropEnum)
  })

  it('diff emits addEnumValue for non-destructive value additions on existing enums', () => {
    const before = pgEnum('status', 'todo', 'done')
    const after = pgEnum('status', 'todo', 'in_progress', 'done')
    const prev = extractSnapshot({ status: before }, 'postgres')
    const next = extractSnapshot({ status: after }, 'postgres')
    const changes = diff(prev, next)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'addEnumValue',
      enum: 'status',
      value: 'in_progress',
      before: 'done',
    })
  })

  it('emit/pg renders CREATE TYPE / DROP TYPE / ALTER TYPE statements', () => {
    const sql = emitPg([
      { kind: 'createEnum', enum: { name: 'role', values: ['admin', 'user'] } },
      { kind: 'addEnumValue', enum: 'role', value: 'guest', before: 'user' },
      { kind: 'addEnumValue', enum: 'role', value: 'banned' }, // appended
      { kind: 'dropEnum', enum: { name: 'role', values: [] } },
    ])
    expect(sql).toContain(`CREATE TYPE "role" AS ENUM ('admin', 'user');`)
    expect(sql).toContain(`ALTER TYPE "role" ADD VALUE 'guest' BEFORE 'user';`)
    expect(sql).toContain(`ALTER TYPE "role" ADD VALUE 'banned';`)
    expect(sql).toContain(`DROP TYPE "role";`)
  })

  it('invertChanges flips createEnum ↔ dropEnum and reverses order', () => {
    const role = pgEnum('role', 'admin', 'user')
    const users = table('users', { id: uuid().primaryKey(), role: role().notNull() })
    const prev = extractSnapshot({}, 'postgres')
    const next = extractSnapshot({ role, users }, 'postgres')
    const forward = diff(prev, next)
    const reverse = invertChanges(forward)
    // Forward starts with createEnum then createTable; reverse should
    // start with dropTable (or its dependents) and end with dropEnum.
    expect(reverse[reverse.length - 1].kind).toBe('dropEnum')
  })

  describe('removed enum value handling', () => {
    it('diff emits a removeEnumValue advisory when values disappear from a kept enum', () => {
      const before = pgEnum('status', 'alpha', 'beta', 'released')
      const after = pgEnum('status', 'alpha', 'released')
      const prev = extractSnapshot({ status: before }, 'postgres')
      const next = extractSnapshot({ status: after }, 'postgres')
      const changes = diff(prev, next)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({
        kind: 'removeEnumValue',
        enum: 'status',
        removed: ['beta'],
      })
    })

    it('diff records multiple removed values in their original declaration order', () => {
      const before = pgEnum('phase', 'draft', 'review', 'staged', 'released', 'archived')
      const after = pgEnum('phase', 'draft', 'released')
      const prev = extractSnapshot({ phase: before }, 'postgres')
      const next = extractSnapshot({ phase: after }, 'postgres')
      const changes = diff(prev, next)
      const removeChange = changes.find((c) => c.kind === 'removeEnumValue')
      expect(removeChange).toBeDefined()
      // Order matches the prev snapshot's value list, not the operator's
      // (potentially ad-hoc) reasoning order.
      expect((removeChange as { removed: readonly string[] }).removed).toEqual([
        'review',
        'staged',
        'archived',
      ])
    })

    it('diff combines additions and removals into separate changes', () => {
      const before = pgEnum('phase', 'draft', 'staged')
      const after = pgEnum('phase', 'draft', 'released')
      const prev = extractSnapshot({ phase: before }, 'postgres')
      const next = extractSnapshot({ phase: after }, 'postgres')
      const changes = diff(prev, next)
      const kinds = changes.map((c) => c.kind)
      expect(kinds).toContain('addEnumValue')
      expect(kinds).toContain('removeEnumValue')
      expect(changes.find((c) => c.kind === 'addEnumValue')).toMatchObject({
        value: 'released',
      })
      expect(changes.find((c) => c.kind === 'removeEnumValue')).toMatchObject({
        removed: ['staged'],
      })
    })

    it('emit/pg renders the rename-recreate block with the KICK ENUM REMOVE header', () => {
      const sql = emitPg([
        {
          kind: 'removeEnumValue',
          enum: 'status',
          removed: ['beta', 'archived'],
          values: ['alpha', 'released'],
          affectedColumns: [{ table: 'orders', column: 'status', default: null }],
        },
      ])
      // Header lines that the runner gate scans for.
      expect(sql).toMatch(/^-- KICK ENUM REMOVE$/m)
      expect(sql).toMatch(/-- enum: "status"/)
      expect(sql).toMatch(/-- removed: 'beta', 'archived'/)
      expect(sql).toMatch(/-- columns: orders\.status/)
      // Rename-recreate dance — the runner's auto-tx wraps the
      // whole up.sql; emitting an explicit BEGIN/COMMIT here would
      // nest and short-circuit the outer transaction.
      expect(sql).not.toContain('BEGIN;')
      expect(sql).not.toContain('COMMIT;')
      expect(sql).toContain('ALTER TYPE "status" RENAME TO "status__old"')
      expect(sql).toContain(`CREATE TYPE "status" AS ENUM ('alpha', 'released')`)
      expect(sql).toContain('ALTER TABLE "orders"')
      expect(sql).toContain('ALTER COLUMN "status" TYPE "status"')
      expect(sql).toContain('USING "status"::text::"status"')
      expect(sql).toContain('DROP TYPE "status__old"')
    })

    it('emit/pg omits the ALTER TABLE step when no columns reference the enum', () => {
      const sql = emitPg([
        {
          kind: 'removeEnumValue',
          enum: 'orphaned',
          removed: ['x'],
          values: ['y'],
          affectedColumns: [],
        },
      ])
      expect(sql).toMatch(/-- columns: \(none\)/)
      expect(sql).not.toContain('ALTER TABLE')
      expect(sql).toContain('ALTER TYPE "orphaned" RENAME TO "orphaned__old"')
      expect(sql).toContain('DROP TYPE "orphaned__old"')
    })

    it('removeEnumValue is flagged as ambiguous-reverse so the down draft warns', () => {
      const before = pgEnum('status', 'a', 'b')
      const after = pgEnum('status', 'a')
      const prev = extractSnapshot({ status: before }, 'postgres')
      const next = extractSnapshot({ status: after }, 'postgres')
      const forward = diff(prev, next)
      expect(hasAmbiguousReverse(forward)).toBe(true)
    })

    it('invertChanges carries removeEnumValue verbatim (symmetric)', () => {
      const change = {
        kind: 'removeEnumValue' as const,
        enum: 'status',
        removed: ['beta'],
        values: ['alpha'],
        affectedColumns: [{ table: 'orders', column: 'status', default: null }],
      }
      const reversed = invertChanges([change])
      expect(reversed).toEqual([change])
    })

    it('emit/pg sanitises newlines + control bytes in the comment header', () => {
      // Pathological input — an adopter passing pgEnum('foo\nDROP TABLE x;', ...)
      // shouldn't be able to escape the SQL comment header by stuffing
      // newlines into the comment text. The header lines must remain
      // line-comment-safe; the DDL portion below the header uses the
      // regular identifier-quoting helpers, which already double-quote
      // any embedded characters (PG accepts them as part of a quoted
      // identifier).
      const sql = emitPg([
        {
          kind: 'removeEnumValue',
          enum: 'foo\nDROP TABLE evil',
          removed: ['bad\nrm -rf', 'safe', '\x07bell'],
          values: ['safe'],
          affectedColumns: [],
        },
      ])
      const lines = sql.split('\n')
      // The header section runs from the first line up to the first
      // statement that doesn't start with `--`. Find that boundary.
      const firstStatementIdx = lines.findIndex((l) => l.trim() !== '' && !l.startsWith('--'))
      expect(firstStatementIdx).toBeGreaterThan(0)

      // Every non-empty line in the header must start with `--` so
      // newline injection inside user-supplied enum/value text can't
      // pop us out of the comment block early.
      for (const line of lines.slice(0, firstStatementIdx)) {
        if (line.trim() === '') continue
        expect(line.startsWith('--')).toBe(true)
      }

      // In the COMMENT header, newlines in user-supplied text collapse
      // to a single space — so `foo\nDROP` never appears in headers.
      const headerSlice = lines.slice(0, firstStatementIdx).join('\n')
      expect(headerSlice).not.toMatch(/foo\nDROP/)
      expect(headerSlice).not.toMatch(/bad\nrm/)
      // C0 control bytes (other than tab / newline) become \x<hh>.
      expect(headerSlice).toMatch(/\\x07bell/)
    })
  })
})
