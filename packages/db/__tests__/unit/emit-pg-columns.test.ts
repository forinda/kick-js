import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

const before = {
  name: 'age',
  type: 'integer',
  nullable: true,
  default: null,
  primaryKey: false,
}
const after = {
  name: 'age',
  type: 'bigint',
  nullable: false,
  default: '0',
  primaryKey: false,
}

describe('emitPg() — column changes', () => {
  it('ADD COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'addColumn',
        table: 'users',
        column: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" ADD COLUMN "email" varchar(255) NOT NULL;')
  })

  it('DROP COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'dropColumn',
        table: 'users',
        column: {
          name: 'legacy',
          type: 'text',
          nullable: true,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" DROP COLUMN "legacy";')
  })

  it('RENAME COLUMN', () => {
    const cs: ChangeSet = [{ kind: 'renameColumn', table: 'users', from: 'emailAddr', to: 'email' }]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" RENAME COLUMN "emailAddr" TO "email";')
  })

  it('ALTER COLUMN — type + nullable + default', () => {
    const cs: ChangeSet = [{ kind: 'alterColumn', table: 'users', column: 'age', before, after }]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint USING "age"::bigint;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET NOT NULL;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET DEFAULT 0;',
    )
  })

  it('ALTER COLUMN — drop default + drop NOT NULL', () => {
    const cs: ChangeSet = [
      {
        kind: 'alterColumn',
        table: 'users',
        column: 'age',
        before: {
          name: 'age',
          type: 'integer',
          nullable: false,
          default: '0',
          primaryKey: false,
        },
        after: {
          name: 'age',
          type: 'integer',
          nullable: true,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" DROP DEFAULT;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" DROP NOT NULL;',
    )
  })
})
