/**
 * Typed database errors. Every query kick/db runs reports a driver failure
 * as one of these instead of the driver's own error, with the constraint,
 * table and columns parsed out where the database says them:
 *
 *   try {
 *     await db.insertInto('users').values({ email }).execute()
 *   } catch (err) {
 *     if (err instanceof UniqueViolationError) return ctx.json({ taken: err.columns }, 409)
 *     throw err
 *   }
 *
 * The driver's error stays reachable as `err.cause`. A `UniqueViolationError`
 * carries `status: 409`, so an unhandled one answers `409 Conflict` rather
 * than `500`.
 */
import { KickDbError } from './errors'

export type DbDialect = 'postgres' | 'mysql' | 'sqlite'

/** What the database reported, parsed. */
export interface DatabaseErrorInfo {
  dialect: DbDialect
  /** SQLSTATE (Postgres, MySQL) or the driver's error code (`SQLITE_CONSTRAINT_UNIQUE`, `ER_DUP_ENTRY`). */
  driverCode?: string
  constraint?: string
  table?: string
  /** Columns involved, when the database names them. */
  columns: string[]
  /** The database's own explanation (Postgres `detail`). */
  detail?: string
}

/** A failure the database reported. Subclasses name the common kinds. */
export class DatabaseError extends KickDbError {
  readonly dialect: DbDialect
  readonly driverCode?: string
  readonly constraint?: string
  readonly table?: string
  readonly columns: string[]
  readonly detail?: string

  constructor(code: string, message: string, info: DatabaseErrorInfo, cause: unknown) {
    super(code, message)
    this.cause = cause
    this.dialect = info.dialect
    this.driverCode = info.driverCode
    this.constraint = info.constraint
    this.table = info.table
    this.columns = info.columns
    this.detail = info.detail
  }

  /** Whether running the transaction again can succeed — true for serialization failures and deadlocks. */
  get retryable(): boolean {
    return false
  }
}

const where = (i: DatabaseErrorInfo): string =>
  [i.table, i.columns.length ? `(${i.columns.join(', ')})` : ''].filter(Boolean).join(' ')

/** A row would duplicate a unique or primary key. Answers `409` when unhandled. */
export class UniqueViolationError extends DatabaseError {
  readonly status = 409
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super('unique_violation', `Duplicate value for ${where(info) || 'a unique key'}`, info, cause)
  }
}

/** A row references one that doesn't exist, or a referenced row was deleted. */
export class ForeignKeyViolationError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super(
      'foreign_key_violation',
      `Foreign key ${info.constraint ? `"${info.constraint}" ` : ''}violated${where(info) ? ` on ${where(info)}` : ''}`,
      info,
      cause,
    )
  }
}

/** A CHECK constraint rejected the row. */
export class CheckViolationError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super(
      'check_violation',
      `Check constraint ${info.constraint ? `"${info.constraint}" ` : ''}failed${info.table ? ` on ${info.table}` : ''}`,
      info,
      cause,
    )
  }
}

/** A NOT NULL column got null. */
export class NotNullViolationError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super('not_null_violation', `${where(info) || 'A column'} cannot be null`, info, cause)
  }
}

/** The transaction conflicted with a concurrent one — run it again. */
export class SerializationFailureError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super('serialization_failure', 'Transaction conflicted with a concurrent one', info, cause)
  }
  override get retryable(): boolean {
    return true
  }
}

/** Two transactions waited on each other; the database cancelled this one — run it again. */
export class DeadlockError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super('deadlock', 'Transaction deadlocked and was cancelled', info, cause)
  }
  override get retryable(): boolean {
    return true
  }
}

/** The database couldn't be reached, or dropped the connection. */
export class ConnectionError extends DatabaseError {
  constructor(info: DatabaseErrorInfo, cause: unknown) {
    super('connection_error', 'Could not reach the database', info, cause)
  }
}

type Raw = Record<string, unknown> & { message?: string }

/** Network-level failures every driver passes through from Node. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
])

/**
 * The typed error for a driver failure, or the input unchanged when it isn't
 * one (a `TypeError` from your own code, an error already translated).
 */
export function translateDbError(err: unknown, dialect: DbDialect): unknown {
  if (!err || typeof err !== 'object' || err instanceof DatabaseError) return err
  const e = err as Raw
  const code = typeof e.code === 'string' ? e.code : undefined
  if (code && NETWORK_CODES.has(code)) {
    return new ConnectionError({ dialect, driverCode: code, columns: [] }, err)
  }
  if (dialect === 'postgres') return fromPostgres(e, err)
  if (dialect === 'mysql') return fromMysql(e, err)
  return fromSqlite(e, err)
}

// ── Postgres (node-postgres) ──────────────────────────────────────────────
// SQLSTATE in `code`; `constraint`, `table`, `column`, `detail` as fields.
function fromPostgres(e: Raw, err: unknown): unknown {
  const code = typeof e.code === 'string' ? e.code : undefined
  if (!code || !/^[0-9A-Z]{5}$/.test(code)) return err
  const detail = str(e.detail)
  // "Key (tenant_id, email)=(1, a@b.c) already exists."
  const keyCols = /Key \(([^)]+)\)=/.exec(detail ?? '')?.[1]
  const info: DatabaseErrorInfo = {
    dialect: 'postgres',
    driverCode: code,
    constraint: str(e.constraint),
    table: str(e.table),
    columns: keyCols ? splitCols(keyCols) : str(e.column) ? [str(e.column)!] : [],
    detail,
  }
  switch (code) {
    case '23505':
      return new UniqueViolationError(info, err)
    case '23503':
      return new ForeignKeyViolationError(info, err)
    case '23514':
      return new CheckViolationError(info, err)
    case '23502':
      return new NotNullViolationError(info, err)
    case '40001':
      return new SerializationFailureError(info, err)
    case '40P01':
      return new DeadlockError(info, err)
  }
  // Class 08 — connection exceptions; 57P01–57P03 — the server is going away.
  if (code.startsWith('08') || /^57P0[123]$/.test(code)) return new ConnectionError(info, err)
  return new DatabaseError('database_error', e.message ?? 'Database error', info, err)
}

/** Too many connections, access denied, server shutdown, and the client's can't-connect / lost-connection errnos. */
const MYSQL_CONNECTION_ERRNOS = new Set([1040, 1045, 1053, 2002, 2003, 2006, 2013])

// ── MySQL (mysql2) ────────────────────────────────────────────────────────
// Numeric `errno`, the name in `code`, and everything else only in the message.
function fromMysql(e: Raw, err: unknown): unknown {
  const errno = typeof e.errno === 'number' ? e.errno : undefined
  if (errno === undefined) return err
  // Client-side connection failures (2002 can't connect, 2013 lost connection, …)
  // come from mysql2 itself with an errno but no SQLSTATE.
  if (!e.sqlState && !MYSQL_CONNECTION_ERRNOS.has(errno)) return err
  const msg = str(e.sqlMessage) ?? e.message ?? ''
  const info: DatabaseErrorInfo = {
    dialect: 'mysql',
    driverCode: str(e.code) ?? String(errno),
    columns: [],
  }
  switch (errno) {
    case 1062: {
      // "Duplicate entry 'a@b.c' for key 'users.users_email_unique'"
      const key = /for key '([^']+)'/.exec(msg)?.[1]
      const [table, constraint] = key?.includes('.') ? key.split('.', 2) : [undefined, key]
      return new UniqueViolationError({ ...info, table, constraint }, err)
    }
    case 1451:
    case 1452: {
      // "... (`db`.`posts`, CONSTRAINT `posts_user_fk` FOREIGN KEY (`user_id`) REFERENCES ..."
      const m = /`([^`]+)`, CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\)/.exec(msg)
      return new ForeignKeyViolationError(
        m ? { ...info, table: m[1], constraint: m[2], columns: splitCols(m[3]!) } : info,
        err,
      )
    }
    case 3819:
      // "Check constraint 'price_positive' is violated."
      return new CheckViolationError(
        { ...info, constraint: /constraint '([^']+)'/i.exec(msg)?.[1] },
        err,
      )
    case 1048:
    case 1364: {
      // "Column 'email' cannot be null" / "Field 'email' doesn't have a default value"
      const col = /(?:Column|Field) '([^']+)'/.exec(msg)?.[1]
      return new NotNullViolationError({ ...info, columns: col ? [col] : [] }, err)
    }
    case 1213:
      return new DeadlockError(info, err)
    case 1205: // lock wait timeout — the same retry fixes it
      return new SerializationFailureError(info, err)
  }
  if (MYSQL_CONNECTION_ERRNOS.has(errno)) return new ConnectionError(info, err)
  return new DatabaseError('database_error', msg || 'Database error', info, err)
}

// ── SQLite (better-sqlite3) ───────────────────────────────────────────────
// Extended result code in `code`; table.column pairs in the message.
function fromSqlite(e: Raw, err: unknown): unknown {
  const code = typeof e.code === 'string' ? e.code : undefined
  if (!code?.startsWith('SQLITE_')) return err
  const msg = e.message ?? ''
  const info: DatabaseErrorInfo = { dialect: 'sqlite', driverCode: code, columns: [] }
  // "UNIQUE constraint failed: users.tenant_id, users.email"
  const qualified = /constraint failed: (.+)$/.exec(msg)?.[1]
  const pairs = qualified?.split(',').map((s) => s.trim().split('.')) ?? []
  const withCols = {
    ...info,
    table: pairs[0]?.length === 2 ? pairs[0][0] : undefined,
    columns: pairs.filter((p) => p.length === 2).map((p) => p[1]!),
  }
  switch (code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      return new UniqueViolationError(withCols, err)
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
      return new ForeignKeyViolationError(info, err)
    case 'SQLITE_CONSTRAINT_CHECK':
      // "CHECK constraint failed: price_positive" — a name, not table.column.
      return new CheckViolationError({ ...info, constraint: qualified }, err)
    case 'SQLITE_CONSTRAINT_NOTNULL':
      return new NotNullViolationError(withCols, err)
    case 'SQLITE_BUSY':
    case 'SQLITE_BUSY_SNAPSHOT':
    case 'SQLITE_LOCKED':
      return new SerializationFailureError(info, err)
    case 'SQLITE_CANTOPEN':
      return new ConnectionError(info, err)
  }
  return new DatabaseError('database_error', msg || 'Database error', info, err)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const splitCols = (s: string): string[] =>
  s.split(',').map((c) => c.trim().replace(/^[`"]|[`"]$/g, ''))
