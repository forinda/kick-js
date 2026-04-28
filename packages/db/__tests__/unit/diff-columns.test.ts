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
        legacy: {
          name: 'legacy',
          type: 'text',
          nullable: true,
          default: null,
          primaryKey: false,
        },
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

  it('add + drop in same diff (different types — no rename)', () => {
    // Differing types short-circuit the rename heuristic so this exercises
    // the basic add/drop path even when both fire in one diff.
    const prev = wrap(
      baseTable({
        a: { name: 'a', type: 'integer', nullable: true, default: null, primaryKey: false },
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
