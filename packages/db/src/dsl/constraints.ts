import type { IndexSnapshot } from '../snapshot/types'
import type { PolicyDecl } from './rls'

interface ColRef {
  __name: string
}

/** An index key part: a column, or an SQL expression such as `'lower(email)'`. */
export type IndexKey = ColRef | string

function keyName(key: IndexKey): string {
  return typeof key === 'string' ? `(${key})` : key.__name
}

/**
 * An index declared in a table's constraint builder. Chain the options;
 * each returns the same declaration:
 *
 *   index('users_active_email').on(t.email).where('"deletedAt" IS NULL')
 *   index('users_email_lower').on('lower(email)')
 *   index('docs_embedding').on(t.embedding).using('hnsw').op(t.embedding, 'vector_cosine_ops')
 *   index('orders_customer').on(t.customerId).include(t.total).concurrently()
 */
export class IndexDecl {
  /** The index as recorded in the snapshot. */
  readonly __index: IndexSnapshot

  constructor(name: string, keys: IndexKey[], unique: boolean) {
    this.__index = { name, columns: keys.map(keyName), unique }
  }

  /** Make it a partial index over the rows matching `predicate` (Postgres, SQLite). */
  where(predicate: string): this {
    this.__index.where = predicate
    return this
  }

  /** The index method: `gin`, `gist`, `brin`, `hash`, `hnsw`, `ivfflat` … (MySQL: `btree` / `hash`). */
  using(method: string): this {
    this.__index.using = method
    return this
  }

  /** Store these columns in the index without making them part of the key (Postgres). */
  include(...cols: ColRef[]): this {
    this.__index.include = cols.map((c) => c.__name)
    return this
  }

  /** The operator class for one key part, e.g. `vector_cosine_ops` or `gin_trgm_ops` (Postgres). */
  op(key: IndexKey, opclass: string): this {
    const name = keyName(key)
    if (!this.__index.columns.includes(name)) {
      throw new Error(`kickjs-db: index '${this.__index.name}' has no key ${name} to give op()`)
    }
    this.__index.opclasses = { ...this.__index.opclasses, [name]: opclass }
    return this
  }

  /**
   * Build and drop it with `CONCURRENTLY`, without blocking writes (Postgres).
   * `kick db generate` puts each such change in a migration of its own that
   * runs outside a transaction, as `CONCURRENTLY` requires.
   */
  concurrently(): this {
    this.__index.concurrently = true
    return this
  }
}

export function index(name: string) {
  return {
    on(...keys: IndexKey[]): IndexDecl {
      return new IndexDecl(name, keys, false)
    },
  }
}

export function unique(name: string) {
  return {
    on(...keys: IndexKey[]): IndexDecl {
      return new IndexDecl(name, keys, true)
    },
  }
}

/** A table's primary key, declared on its own — required for a composite or named key. */
export interface PrimaryKeyDecl {
  kind: 'primaryKey'
  /** Constraint name; Postgres otherwise names it `<table>_pkey`. MySQL and SQLite ignore it. */
  name?: string
  columns: string[]
}

/** A CHECK constraint. */
export interface CheckDecl {
  kind: 'check'
  name: string
  /** SQL boolean expression, written for the target dialect. */
  expression: string
}

/** Anything a table's constraint builder may return. */
export type TableConstraint = IndexDecl | PrimaryKeyDecl | CheckDecl | PolicyDecl

/**
 * The table's primary key, over one or more columns, in key order:
 *
 *   table('memberships', { teamId: integer(), userId: integer() }, (t) => ({
 *     pk: primaryKey('memberships_pk').on(t.teamId, t.userId),
 *   }))
 *
 * Use this or a column's `.primaryKey()`, not both.
 */
export function primaryKey(name?: string) {
  return {
    on(...cols: ColRef[]): PrimaryKeyDecl {
      return name === undefined
        ? { kind: 'primaryKey', columns: cols.map((c) => c.__name) }
        : { kind: 'primaryKey', name, columns: cols.map((c) => c.__name) }
    },
  }
}

/**
 * A CHECK constraint — `check('price_positive', 'price > 0')`. The
 * expression is SQL, passed through as written.
 */
export function check(name: string, expression: string): CheckDecl {
  return { kind: 'check', name, expression }
}
