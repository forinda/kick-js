import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, IndexSnapshot, ForeignKeySnapshot } from '@forinda/kickjs-db'

const idx = (name: string): IndexSnapshot => ({ name, columns: ['x'], unique: false })
const fk = (name: string): ForeignKeySnapshot => ({
  name,
  columns: ['x'],
  refTable: 'other',
  refColumns: ['id'],
  onDelete: 'no_action',
  onUpdate: 'no_action',
})

const wrap = (indexes: IndexSnapshot[], foreignKeys: ForeignKeySnapshot[]): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    t: { name: 't', columns: {}, indexes, foreignKeys, checks: [] },
  },
})

describe('diff() — indexes & FKs', () => {
  it('adds new index', () => {
    const c = diff(wrap([], []), wrap([idx('i1')], []))
    expect(c[0]).toMatchObject({ kind: 'addIndex', table: 't', index: { name: 'i1' } })
  })

  it('drops removed index', () => {
    const c = diff(wrap([idx('i1')], []), wrap([], []))
    expect(c[0]).toMatchObject({ kind: 'dropIndex', table: 't', index: { name: 'i1' } })
  })

  it('adds new FK', () => {
    const c = diff(wrap([], []), wrap([], [fk('f1')]))
    expect(c[0]).toMatchObject({ kind: 'addForeignKey', table: 't', fk: { name: 'f1' } })
  })

  it('drops removed FK', () => {
    const c = diff(wrap([], [fk('f1')]), wrap([], []))
    expect(c[0]).toMatchObject({ kind: 'dropForeignKey', table: 't', fk: { name: 'f1' } })
  })
})
