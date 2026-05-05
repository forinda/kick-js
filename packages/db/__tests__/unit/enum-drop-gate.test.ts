/**
 * Coverage for the runner gate that detects the `-- KICK ENUM
 * REMOVE` header in a migration's up.sql and refuses to apply
 * without `confirmEnumDrop`.
 *
 * Spec: docs/db/spec-enum-value-removal.md §4.
 */

import { describe, expect, it } from 'vitest'
import { parseEnumDropHeader, enforceEnumDropGate, MigrationEnumDropError } from '../../src/index'

const HEADER_FIXTURE = `-- KICK ENUM REMOVE
-- enum: "task_priority"
-- removed: 'unused', 'archived'
-- columns: tasks.priority

BEGIN;
  ALTER TYPE "task_priority" RENAME TO "task_priority__old";
  CREATE TYPE "task_priority" AS ENUM ('critical', 'high', 'medium', 'low', 'none');
  ALTER TABLE "tasks"
    ALTER COLUMN "priority" TYPE "task_priority"
    USING "priority"::text::"task_priority";
  DROP TYPE "task_priority__old";
COMMIT;
`

const ORDINARY_FIXTURE = `CREATE TABLE "users" ("id" serial PRIMARY KEY);
ALTER TABLE "users" ADD COLUMN "email" varchar(255);
`

describe('parseEnumDropHeader', () => {
  it('returns null when the header literal is absent', () => {
    expect(parseEnumDropHeader(ORDINARY_FIXTURE)).toBeNull()
  })

  it('parses enum / removed / columns from a well-formed header', () => {
    const out = parseEnumDropHeader(HEADER_FIXTURE)
    expect(out).toEqual({
      enums: ['"task_priority"'],
      removed: ['unused', 'archived'],
      columns: ['tasks.priority'],
    })
  })

  it('treats `(none)` columns as an empty list', () => {
    const sql = `-- KICK ENUM REMOVE
-- enum: "x"
-- removed: 'y'
-- columns: (none)
`
    expect(parseEnumDropHeader(sql)).toEqual({
      enums: ['"x"'],
      removed: ['y'],
      columns: [],
    })
  })

  it('returns an empty payload object when the header literal lacks key:value lines', () => {
    const sql = `-- KICK ENUM REMOVE
-- (no payload)
`
    expect(parseEnumDropHeader(sql)).toEqual({ enums: [], removed: [], columns: [] })
  })

  it('handles multiple header blocks back-to-back', () => {
    const sql = `-- KICK ENUM REMOVE
-- enum: "a"
-- removed: 'x'
-- columns: t1.c1

BEGIN;
COMMIT;

-- KICK ENUM REMOVE
-- enum: "b"
-- removed: 'y'
-- columns: t2.c2

BEGIN;
COMMIT;
`
    const out = parseEnumDropHeader(sql)
    expect(out?.enums).toEqual(['"a"', '"b"'])
    expect(out?.removed).toEqual(['x', 'y'])
    expect(out?.columns).toEqual(['t1.c1', 't2.c2'])
  })
})

describe('enforceEnumDropGate', () => {
  it('returns null + does not throw on ordinary migrations', () => {
    expect(enforceEnumDropGate('20260505_a', ORDINARY_FIXTURE, false)).toBeNull()
    expect(enforceEnumDropGate('20260505_a', ORDINARY_FIXTURE, true)).toBeNull()
  })

  it('throws MigrationEnumDropError when the header is present and confirmEnumDrop is false', () => {
    expect(() => enforceEnumDropGate('20260505_b', HEADER_FIXTURE, false)).toThrow(
      MigrationEnumDropError,
    )
  })

  it('returns the parsed header when confirmEnumDrop is true', () => {
    const header = enforceEnumDropGate('20260505_b', HEADER_FIXTURE, true)
    expect(header).toEqual({
      enums: ['"task_priority"'],
      removed: ['unused', 'archived'],
      columns: ['tasks.priority'],
    })
  })

  it('error carries id + parsed enums / removed / columns', () => {
    try {
      enforceEnumDropGate('20260505_b', HEADER_FIXTURE, false)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationEnumDropError)
      const e = err as MigrationEnumDropError
      expect(e.id).toBe('20260505_b')
      expect(e.enums).toEqual(['"task_priority"'])
      expect(e.removed).toEqual(['unused', 'archived'])
      expect(e.columns).toEqual(['tasks.priority'])
      expect(e.message).toContain('--confirm-enum-drop')
    }
  })
})
