import { describe, it, expect } from 'vitest'
import { invertChanges, hasAmbiguousReverse } from '@forinda/kickjs-db'
import type { ChangeSet, ColumnSnapshot, TableSnapshot } from '@forinda/kickjs-db'

const usersTable: TableSnapshot = {
  name: 'users',
  columns: {
    id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
  },
  indexes: [],
  foreignKeys: [],
  checks: [],
}

const emailCol: ColumnSnapshot = {
  name: 'email',
  type: 'varchar(255)',
  nullable: false,
  default: null,
  primaryKey: false,
}

describe('invertChanges()', () => {
  it('reverses createTable → dropTable', () => {
    const fwd: ChangeSet = [{ kind: 'createTable', table: usersTable }]
    expect(invertChanges(fwd)).toEqual([{ kind: 'dropTable', table: usersTable }])
  })

  it('reverses addColumn → dropColumn carrying the column descriptor', () => {
    const fwd: ChangeSet = [{ kind: 'addColumn', table: 'users', column: emailCol }]
    expect(invertChanges(fwd)).toEqual([{ kind: 'dropColumn', table: 'users', column: emailCol }])
  })

  it('reverses alterColumn by swapping before/after', () => {
    const before: ColumnSnapshot = { ...emailCol, type: 'varchar(50)' }
    const after: ColumnSnapshot = { ...emailCol, type: 'text' }
    const fwd: ChangeSet = [{ kind: 'alterColumn', table: 'users', column: 'email', before, after }]
    expect(invertChanges(fwd)).toEqual([
      { kind: 'alterColumn', table: 'users', column: 'email', before: after, after: before },
    ])
  })

  it('reverses renameTable / renameColumn by swapping from/to', () => {
    const fwd: ChangeSet = [
      { kind: 'renameTable', from: 'users', to: 'accounts' },
      { kind: 'renameColumn', table: 'accounts', from: 'email', to: 'emailAddr' },
    ]
    const inv = invertChanges(fwd)
    expect(inv).toEqual([
      { kind: 'renameColumn', table: 'accounts', from: 'emailAddr', to: 'email' },
      { kind: 'renameTable', from: 'accounts', to: 'users' },
    ])
  })

  it('reverses the order so teardown matches dependencies', () => {
    const fwd: ChangeSet = [
      { kind: 'createTable', table: usersTable },
      { kind: 'addIndex', table: 'users', index: { name: 'i', columns: ['id'], unique: false } },
      {
        kind: 'addForeignKey',
        table: 'users',
        fk: {
          name: 'fk',
          columns: ['id'],
          refTable: 'other',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      },
    ]
    const inv = invertChanges(fwd)
    expect(inv.map((c) => c.kind)).toEqual(['dropForeignKey', 'dropIndex', 'dropTable'])
  })
})

describe('hasAmbiguousReverse()', () => {
  it('flags drop column / drop table / alter column', () => {
    expect(hasAmbiguousReverse([{ kind: 'dropTable', table: usersTable }])).toBe(true)
    expect(hasAmbiguousReverse([{ kind: 'dropColumn', table: 'users', column: emailCol }])).toBe(
      true,
    )
    expect(
      hasAmbiguousReverse([
        {
          kind: 'alterColumn',
          table: 'users',
          column: 'email',
          before: emailCol,
          after: { ...emailCol, type: 'text' },
        },
      ]),
    ).toBe(true)
  })

  it('does not flag clean reverses (createTable / addColumn / addIndex / addForeignKey)', () => {
    expect(hasAmbiguousReverse([{ kind: 'createTable', table: usersTable }])).toBe(false)
    expect(hasAmbiguousReverse([{ kind: 'addColumn', table: 'users', column: emailCol }])).toBe(
      false,
    )
  })
})
