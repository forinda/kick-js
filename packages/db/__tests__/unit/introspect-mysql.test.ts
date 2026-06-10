import { describe, it, expect } from 'vitest'
import { introspectMysql, type MysqlIntrospectDb } from '@forinda/kickjs-db'

/** Mock pool: route each information_schema query to canned rows. */
function mockDb(rowsByMatch: { match: RegExp; rows: unknown[] }[]): MysqlIntrospectDb {
  return {
    async query<R = unknown>(sql: string): Promise<[R, unknown]> {
      const hit = rowsByMatch.find((r) => r.match.test(sql))
      return [(hit?.rows ?? []) as R, []]
    },
  }
}

describe('introspectMysql', () => {
  it('maps columns / indexes / fks from information_schema', async () => {
    const db = mockDb([
      { match: /FROM information_schema\.TABLES/, rows: [{ TABLE_NAME: 'tasks' }] },
      {
        match: /FROM information_schema\.COLUMNS/,
        rows: [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'char',
            COLUMN_TYPE: 'char(36)',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            COLUMN_KEY: 'PRI',
            EXTRA: '',
          },
          {
            COLUMN_NAME: 'done',
            DATA_TYPE: 'tinyint',
            COLUMN_TYPE: 'tinyint(1)',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: '0',
            COLUMN_KEY: '',
            EXTRA: '',
          },
        ],
      },
      {
        match: /FROM information_schema\.STATISTICS/,
        rows: [
          { INDEX_NAME: 'tasks_done_idx', COLUMN_NAME: 'done', NON_UNIQUE: 1, SEQ_IN_INDEX: 1 },
        ],
      },
      {
        match: /FROM information_schema\.KEY_COLUMN_USAGE/,
        rows: [
          {
            CONSTRAINT_NAME: 'fk_author',
            COLUMN_NAME: 'author_id',
            REF_TABLE: 'users',
            REF_COLUMN: 'id',
            DELETE_RULE: 'CASCADE',
            UPDATE_RULE: 'NO ACTION',
            ORDINAL_POSITION: 1,
          },
        ],
      },
    ])

    const snap = await introspectMysql(db)
    expect(snap.dialect).toBe('mysql')
    const t = snap.tables.tasks
    expect(t.columns.id).toMatchObject({ type: 'char(36)', nullable: false, primaryKey: true })
    expect(t.columns.done).toMatchObject({ type: 'tinyint(1)', nullable: false, default: '0' })
    expect(t.indexes).toEqual([{ name: 'tasks_done_idx', columns: ['done'], unique: false }])
    expect(t.foreignKeys[0]).toMatchObject({
      name: 'fk_author',
      columns: ['author_id'],
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'cascade',
      onUpdate: 'no_action',
    })
  })
})
