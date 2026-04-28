import { describe, it, expect, expectTypeOf } from 'vitest'

import { table, uuid } from '../../src/index'
import { pgEnum, PgEnumColumnBuilder } from '../../src/dsl/columns/pg'
import type { SchemaToKysely } from '../../src/index'
import type { Generated } from 'kysely'

describe('pgEnum()', () => {
  it('factory carries the enum name + values', () => {
    const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done'])
    expect(taskStatus.enumName).toBe('task_status')
    expect(taskStatus.values).toEqual(['todo', 'in_progress', 'done'])
  })

  it('column builder uses the enum name as the SQL data type', () => {
    const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done'])
    const col = taskStatus()
    expect(col).toBeInstanceOf(PgEnumColumnBuilder)
    expect(col.__state().type).toBe('task_status')
    expect(col.enumName).toBe('task_status')
    expect(col.values).toEqual(['todo', 'in_progress', 'done'])
  })

  it('phantom type narrows to the union of declared literals', () => {
    const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done'])
    const tasks = table('tasks', {
      id: uuid().primaryKey().defaultRandom(),
      status: taskStatus().notNull(),
      next_status: taskStatus(), // nullable
    })

    const schema = { tasks }
    type DB = SchemaToKysely<typeof schema>

    expectTypeOf<DB['tasks']>().toEqualTypeOf<{
      id: Generated<string>
      status: 'todo' | 'in_progress' | 'done'
      next_status: 'todo' | 'in_progress' | 'done' | null
    }>()
  })

  it('values stay narrow even when inferred from a stored variable', () => {
    // Regression — without `const TValues` the array would widen to
    // `string[]` and the phantom would resolve to plain `string`.
    const VALUES = ['todo', 'in_progress', 'done']
    const status = pgEnum('task_status', VALUES)
    const col = status()

    type Phantom = (typeof col)['__t']
    expectTypeOf<Phantom>().toEqualTypeOf<('todo' | 'in_progress' | 'done') | undefined>()
  })

  it('two factory invocations produce independent column instances (no shared mutation)', () => {
    const role = pgEnum('role', ['admin', 'user'])
    const a = role()
    const b = role()
    expect(a).not.toBe(b)
    a.notNull()
    expect(a.__state().nullable).toBe(false)
    expect(b.__state().nullable).toBe(true)
  })
})
