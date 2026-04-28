import { describe, it, expect } from 'vitest'

import { table, uuid, varchar } from '../../src/index'
import { pgEnum } from '../../src/dsl/columns/pg'
import { extractSnapshot } from '../../src/snapshot/extract'
import { diff } from '../../src/diff/engine'
import { invertChanges } from '../../src/diff/invert'
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
})
