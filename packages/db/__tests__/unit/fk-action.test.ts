/** `references(…, { onDelete, onUpdate })`: an action outside the list fails where it's written, not as `undefined` in the SQL. */
import { describe, expect, it } from 'vitest'
import { diff, emitPg, extractSnapshot, integer, serial, table } from '@forinda/kickjs-db'

const users = table('users', { id: serial().primaryKey() })

describe('foreign key actions', () => {
  it('refuses an action that is not one of the five', () => {
    expect(() => integer().references(() => users.id, { onDelete: 'set null' as never })).toThrow(
      "references(): onDelete 'set null' isn't an action — use 'cascade', 'restrict', 'set_null', 'set_default' or 'no_action'",
    )
    expect(() => integer().references(() => users.id, { onUpdate: 'CASCADE' as never })).toThrow(
      "onUpdate 'CASCADE'",
    )
  })

  it('valid actions reach the SQL', () => {
    const schema = {
      users,
      posts: table('posts', {
        id: serial().primaryKey(),
        userId: integer().references(() => users.id, { onDelete: 'set_null', onUpdate: 'cascade' }),
      }),
    }
    const sql = emitPg(
      diff({ version: 1, dialect: 'postgres', tables: {} }, extractSnapshot(schema, 'postgres')),
    )
    expect(sql).toContain('ON DELETE SET NULL ON UPDATE CASCADE')
    expect(sql).not.toContain('undefined')
  })
})

describe('the usual mistypes are refused', () => {
  const MISTYPES = [
    'set null',
    'SET NULL',
    'setNull',
    'set-null',
    'SetNull',
    'Cascade',
    'CASCADE',
    'no action',
    'NO ACTION',
    'noAction',
    'set default',
    'setDefault',
    'RESTRICT',
    ' cascade',
    'cascade ',
    '',
    null,
  ]
  for (const key of ['onDelete', 'onUpdate'] as const)
    for (const action of MISTYPES)
      it(`${key}: ${JSON.stringify(action)}`, () => {
        expect(() => integer().references(() => users.id, { [key]: action as never })).toThrow(
          `references(): ${key} '${action}' isn't an action`,
        )
      })

  it('all five valid actions are accepted', () => {
    for (const action of ['cascade', 'restrict', 'set_null', 'set_default', 'no_action'] as const)
      expect(() =>
        integer().references(() => users.id, { onDelete: action, onUpdate: action }),
      ).not.toThrow()
  })
})
