import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, ColumnSnapshot } from '@forinda/kickjs-db'

const wrap = (col: ColumnSnapshot): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    t: {
      name: 't',
      columns: { c: col },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
})

const base: ColumnSnapshot = {
  name: 'c',
  type: 'integer',
  nullable: true,
  default: null,
  primaryKey: false,
}

describe('diff() — alter column', () => {
  it('detects type change', () => {
    const changes = diff(wrap(base), wrap({ ...base, type: 'bigint' }))
    expect(changes[0]).toMatchObject({
      kind: 'alterColumn',
      table: 't',
      column: 'c',
      before: { type: 'integer' },
      after: { type: 'bigint' },
    })
  })

  it('detects nullable change', () => {
    const changes = diff(wrap(base), wrap({ ...base, nullable: false }))
    expect(changes[0]).toMatchObject({ kind: 'alterColumn' })
  })

  it('detects default change', () => {
    const changes = diff(wrap(base), wrap({ ...base, default: '0' }))
    expect(changes[0]).toMatchObject({ kind: 'alterColumn' })
  })

  it('no change when columns equal', () => {
    expect(diff(wrap(base), wrap(base))).toEqual([])
  })
})
