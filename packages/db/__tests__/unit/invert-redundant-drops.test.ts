/**
 * Inverting a fresh-schema migration (createTable + addIndex +
 * addForeignKey) must NOT emit dropForeignKey / dropIndex for tables the
 * same inverted set drops outright — DROP TABLE removes both, and on
 * SQLite the FK/index drop compiles to a table rebuild against the
 * post-state snapshot, which no longer contains the table. This was the
 * `SqliteRebuildRequiredError: no resolved snapshot for table 'X'`
 * failure on every first `kick db generate` for an FK-bearing schema.
 */
import { describe, it, expect } from 'vitest'

import { invertChanges } from '../../src/diff/invert'
import type { ChangeSet } from '../../src/diff/types'
import type { ForeignKeySnapshot, TableSnapshot } from '../../src/snapshot/types'

function tableSnap(name: string): TableSnapshot {
  return { name, columns: {}, indexes: [], foreignKeys: [], checks: [] }
}

const FK: ForeignKeySnapshot = {
  name: 'tasks_projectId_fk',
  columns: ['projectId'],
  refTable: 'projects',
  refColumns: ['id'],
  onDelete: 'cascade',
  onUpdate: 'no_action',
}

describe('invertChanges — redundant teardown pruning', () => {
  it('drops FK/index inversions for tables the inverted set drops', () => {
    const forward: ChangeSet = [
      { kind: 'createTable', table: tableSnap('projects') },
      { kind: 'createTable', table: tableSnap('tasks') },
      {
        kind: 'addIndex',
        table: 'tasks',
        index: { name: 'tasks_done_idx', columns: ['done'], unique: false },
      },
      { kind: 'addForeignKey', table: 'tasks', fk: FK },
    ]

    const down = invertChanges(forward)
    expect(down.map((c) => c.kind)).toEqual(['dropTable', 'dropTable'])
  })

  it('keeps FK/index drops for tables that survive', () => {
    const forward: ChangeSet = [
      { kind: 'createTable', table: tableSnap('projects') },
      // tasks pre-exists — only its FK is added this migration.
      { kind: 'addForeignKey', table: 'tasks', fk: FK },
    ]

    const down = invertChanges(forward)
    expect(down.map((c) => c.kind)).toEqual(['dropForeignKey', 'dropTable'])
  })
})
