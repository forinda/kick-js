import { describe, expect, it } from 'vitest'
import {
  alterTypeAddValue,
  alterTypeRenameTo,
  alterTypeRenameValue,
  renderAlterType,
} from '@forinda/kickjs-db/emit/alter-type'

// M5.B.1 — pure-function coverage for the typed-IR helpers. The
// rendered SQL is also gated by the existing snapshot tests in
// pg-enum-pipeline.test.ts and default-preservation.test.ts (those
// lock byte-identity against pre-refactor output); the cases here
// cover the helpers' own surface — argument shapes, the `before`/
// `after` mutual-exclusion guard, identifier quoting — without
// reaching through `emitPg`.

describe('renderAlterType / RENAME TO', () => {
  it('renders the historic uppercase shape with double-quoted identifiers', () => {
    const sql = renderAlterType(alterTypeRenameTo('task_priority', 'task_priority__old'))
    expect(sql).toBe(`ALTER TYPE "task_priority" RENAME TO "task_priority__old";`)
  })
})

describe('renderAlterType / ADD VALUE', () => {
  it('renders a bare ADD VALUE when no position is supplied', () => {
    const sql = renderAlterType(alterTypeAddValue('role', 'banned'))
    expect(sql).toBe(`ALTER TYPE "role" ADD VALUE 'banned';`)
  })

  it('renders ADD VALUE … BEFORE … when `before` is supplied', () => {
    const sql = renderAlterType(alterTypeAddValue('role', 'guest', { before: 'user' }))
    expect(sql).toBe(`ALTER TYPE "role" ADD VALUE 'guest' BEFORE 'user';`)
  })

  it('renders ADD VALUE … AFTER … when `after` is supplied', () => {
    const sql = renderAlterType(alterTypeAddValue('role', 'auditor', { after: 'admin' }))
    expect(sql).toBe(`ALTER TYPE "role" ADD VALUE 'auditor' AFTER 'admin';`)
  })

  it('throws when both `before` and `after` are set', () => {
    expect(() =>
      renderAlterType(alterTypeAddValue('role', 'x', { before: 'a', after: 'b' })),
    ).toThrow(/mutually exclusive/)
  })
})

describe('renderAlterType / RENAME VALUE', () => {
  it('renders a RENAME VALUE statement with quoted literals', () => {
    const sql = renderAlterType(alterTypeRenameValue('priority', 'low', 'minimal'))
    expect(sql).toBe(`ALTER TYPE "priority" RENAME VALUE 'low' TO 'minimal';`)
  })
})
