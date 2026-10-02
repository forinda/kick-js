/**
 * Driver errors → typed errors, per dialect. The shapes mirror what
 * node-postgres, mysql2 and better-sqlite3 throw; the integration tests
 * check the same paths against real databases.
 */
import { describe, expect, it } from 'vitest'
import {
  CheckViolationError,
  ConnectionError,
  DatabaseError,
  DeadlockError,
  ForeignKeyViolationError,
  NotNullViolationError,
  SerializationFailureError,
  UniqueViolationError,
  translateDbError,
} from '@forinda/kickjs-db'

const pg = (fields: Record<string, unknown>) =>
  Object.assign(new Error(String(fields.message ?? 'pg error')), fields)

describe('translateDbError — postgres', () => {
  it('parses a composite unique violation from detail', () => {
    const err = translateDbError(
      pg({
        code: '23505',
        constraint: 'users_tenant_email_key',
        table: 'users',
        detail: 'Key (tenant_id, email)=(1, a@b.c) already exists.',
      }),
      'postgres',
    ) as UniqueViolationError
    expect(err).toBeInstanceOf(UniqueViolationError)
    expect(err).toMatchObject({
      status: 409,
      constraint: 'users_tenant_email_key',
      table: 'users',
      columns: ['tenant_id', 'email'],
      driverCode: '23505',
      retryable: false,
    })
    expect(err.message).toBe('Duplicate value for users (tenant_id, email)')
    expect((err.cause as Error).message).toBe('pg error')
  })

  it.each([
    ['23503', ForeignKeyViolationError],
    ['23514', CheckViolationError],
    ['23502', NotNullViolationError],
    ['40001', SerializationFailureError],
    ['40P01', DeadlockError],
    ['08006', ConnectionError],
    ['57P01', ConnectionError],
  ] as const)('maps SQLSTATE %s', (code, Type) => {
    expect(translateDbError(pg({ code }), 'postgres')).toBeInstanceOf(Type)
  })

  it('takes the not-null column from `column`, and flags retryable kinds', () => {
    const nn = translateDbError(pg({ code: '23502', table: 't', column: 'email' }), 'postgres')
    expect((nn as DatabaseError).columns).toEqual(['email'])
    expect((translateDbError(pg({ code: '40001' }), 'postgres') as DatabaseError).retryable).toBe(
      true,
    )
  })

  it('wraps other SQLSTATEs as DatabaseError and leaves non-driver errors alone', () => {
    const other = translateDbError(
      pg({ code: '42P01', message: 'relation "x" does not exist' }),
      'postgres',
    )
    expect(other).toBeInstanceOf(DatabaseError)
    expect((other as DatabaseError).message).toBe('relation "x" does not exist')
    const plain = new TypeError('boom')
    expect(translateDbError(plain, 'postgres')).toBe(plain)
    expect(
      translateDbError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), 'postgres'),
    ).toBeInstanceOf(ConnectionError)
  })

  it('does not translate twice', () => {
    const once = translateDbError(pg({ code: '23505' }), 'postgres')
    expect(translateDbError(once, 'postgres')).toBe(once)
  })
})

const my = (errno: number, sqlMessage: string, code = 'ER') =>
  Object.assign(new Error(sqlMessage), { errno, sqlMessage, code, sqlState: '23000' })

describe('translateDbError — mysql', () => {
  it('reads table and key from a duplicate entry', () => {
    const err = translateDbError(
      my(1062, "Duplicate entry 'a@b.c' for key 'users.users_email_unique'", 'ER_DUP_ENTRY'),
      'mysql',
    )
    expect(err).toBeInstanceOf(UniqueViolationError)
    expect(err).toMatchObject({
      table: 'users',
      constraint: 'users_email_unique',
      driverCode: 'ER_DUP_ENTRY',
    })
  })

  it('reads the foreign key, check and not-null names from the message', () => {
    const fk = translateDbError(
      my(
        1452,
        'Cannot add or update a child row: a foreign key constraint fails (`app`.`posts`, CONSTRAINT `posts_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`))',
      ),
      'mysql',
    )
    expect(fk).toMatchObject({ table: 'posts', constraint: 'posts_user_fk', columns: ['user_id'] })
    expect(
      translateDbError(my(3819, "Check constraint 'price_positive' is violated."), 'mysql'),
    ).toMatchObject({
      constraint: 'price_positive',
    })
    expect(translateDbError(my(1048, "Column 'email' cannot be null"), 'mysql')).toMatchObject({
      columns: ['email'],
    })
  })

  it('maps deadlock, lock wait and connection errnos', () => {
    expect(translateDbError(my(1213, 'Deadlock found'), 'mysql')).toBeInstanceOf(DeadlockError)
    expect(translateDbError(my(1205, 'Lock wait timeout'), 'mysql')).toBeInstanceOf(
      SerializationFailureError,
    )
    expect(translateDbError(my(2013, 'Lost connection'), 'mysql')).toBeInstanceOf(ConnectionError)
    // mysql2's own connection errors have an errno but no SQLSTATE.
    const lost = Object.assign(new Error('Lost connection to MySQL server during query'), {
      errno: 2013,
      code: 'CR_SERVER_LOST',
    })
    expect(translateDbError(lost, 'mysql')).toBeInstanceOf(ConnectionError)
    // Without a SQLSTATE, anything else isn't a server error — left as is.
    const other = Object.assign(new Error('x'), { errno: 9999 })
    expect(translateDbError(other, 'mysql')).toBe(other)
  })
})

const lite = (code: string, message: string) => Object.assign(new Error(message), { code })

describe('translateDbError — sqlite', () => {
  it('reads table and columns from a unique failure', () => {
    const err = translateDbError(
      lite('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: users.tenant_id, users.email'),
      'sqlite',
    )
    expect(err).toBeInstanceOf(UniqueViolationError)
    expect(err).toMatchObject({ table: 'users', columns: ['tenant_id', 'email'] })
  })

  it('maps the other constraint and busy codes', () => {
    expect(
      translateDbError(
        lite('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed'),
        'sqlite',
      ),
    ).toBeInstanceOf(ForeignKeyViolationError)
    expect(
      translateDbError(
        lite('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: price_positive'),
        'sqlite',
      ),
    ).toMatchObject({
      constraint: 'price_positive',
    })
    expect(
      translateDbError(
        lite('SQLITE_CONSTRAINT_NOTNULL', 'NOT NULL constraint failed: users.email'),
        'sqlite',
      ),
    ).toMatchObject({
      table: 'users',
      columns: ['email'],
    })
    expect(translateDbError(lite('SQLITE_BUSY', 'database is locked'), 'sqlite')).toBeInstanceOf(
      SerializationFailureError,
    )
  })
})
