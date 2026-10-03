/** D.24: table and column comments through snapshot, diff, invert, emit and render. */
import { describe, expect, it } from 'vitest'
import {
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  invertChanges,
  renderSchemaSource,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'

const v1 = {
  users: table(
    'users',
    {
      id: serial().primaryKey(),
      email: varchar(200).notNull().comment("The user's sign-in address"),
    },
    { comment: 'People who sign in' },
  ),
}
const v2 = {
  users: table('users', {
    id: serial().primaryKey().comment('Row id'),
    email: varchar(200).notNull().comment('Sign-in address'),
    bio: text().comment('Shown on the profile'),
  }),
}
const empty = (dialect: 'postgres' | 'mysql' | 'sqlite') => ({
  version: 1 as const,
  dialect,
  tables: {},
})

describe('comments', () => {
  it('create them with the table on Postgres and MySQL', () => {
    const pg = emitPg(diff(empty('postgres'), extractSnapshot(v1, 'postgres')))
    expect(pg).toContain(`COMMENT ON TABLE "users" IS 'People who sign in';`)
    expect(pg).toContain(`COMMENT ON COLUMN "users"."email" IS 'The user''s sign-in address';`)
    const mysql = emitMysql(diff(empty('mysql'), extractSnapshot(v1, 'mysql')))
    expect(mysql).toContain("`email` VARCHAR(200) NOT NULL COMMENT 'The user''s sign-in address'")
    expect(mysql).toContain(") COMMENT='People who sign in';")
  })

  it('change as their own changes, never an alterColumn, and invert', () => {
    const changes = diff(extractSnapshot(v1, 'postgres'), extractSnapshot(v2, 'postgres'))
    expect(changes.map((c) => c.kind).toSorted()).toEqual([
      'addColumn',
      'setColumnComment',
      'setColumnComment',
      'setTableComment',
    ])
    const pg = emitPg(changes)
    expect(pg).toContain(`COMMENT ON TABLE "users" IS NULL;`)
    expect(pg).toContain(`COMMENT ON COLUMN "users"."email" IS 'Sign-in address';`)
    expect(pg).toContain(`COMMENT ON COLUMN "users"."bio" IS 'Shown on the profile';`)
    expect(emitPg(invertChanges(changes))).toContain(
      `COMMENT ON TABLE "users" IS 'People who sign in';`,
    )
  })

  it('on MySQL restate the column, keeping AUTO_INCREMENT on a serial key', () => {
    const mysql = emitMysql(diff(extractSnapshot(v1, 'mysql'), extractSnapshot(v2, 'mysql')))
    expect(mysql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `id` INT NOT NULL AUTO_INCREMENT COMMENT 'Row id';",
    )
    expect(mysql).toContain("ALTER TABLE `users` COMMENT = '';")
  })

  it("aren't stored on SQLite, so they make no migration", () => {
    expect(
      diff(extractSnapshot(v1, 'sqlite'), extractSnapshot(v2, 'sqlite')).map((c) => c.kind),
    ).toEqual(['addColumn'])
    expect(emitSqlite(diff(empty('sqlite'), extractSnapshot(v1, 'sqlite')))).not.toContain(
      'COMMENT',
    )
  })

  it('render back into the schema', () => {
    const src = renderSchemaSource(extractSnapshot(v1, 'postgres'))
    expect(src).toContain(`.comment("The user's sign-in address")`)
    expect(src).toContain(`{ comment: 'People who sign in' }`)
  })
})
