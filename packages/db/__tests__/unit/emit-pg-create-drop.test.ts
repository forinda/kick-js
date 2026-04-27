import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet, TableSnapshot } from '@forinda/kickjs-db'

const usersTable: TableSnapshot = {
  name: 'users',
  columns: {
    id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
    email: {
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    },
  },
  indexes: [],
  foreignKeys: [],
  checks: [],
}

describe('emitPg() — create/drop/rename table', () => {
  it('emits CREATE TABLE', () => {
    const changes: ChangeSet = [{ kind: 'createTable', table: usersTable }]
    expect(emitPg(changes)).toBe(
      'CREATE TABLE "users" (\n' +
        '  "id" serial NOT NULL,\n' +
        '  "email" varchar(255) NOT NULL,\n' +
        '  PRIMARY KEY ("id")\n' +
        ');',
    )
  })

  it('emits DROP TABLE', () => {
    const changes: ChangeSet = [{ kind: 'dropTable', table: usersTable }]
    expect(emitPg(changes)).toBe('DROP TABLE "users";')
  })

  it('emits ALTER TABLE RENAME', () => {
    const changes: ChangeSet = [{ kind: 'renameTable', from: 'users', to: 'accounts' }]
    expect(emitPg(changes)).toBe('ALTER TABLE "users" RENAME TO "accounts";')
  })
})
