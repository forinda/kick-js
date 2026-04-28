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
