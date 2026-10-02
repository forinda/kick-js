export interface IndexDecl {
  name: string
  columns: string[]
  unique: boolean
}

interface ColRef {
  __name: string
}

export function index(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: false }
    },
  }
}

export function unique(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: true }
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
export type TableConstraint = IndexDecl | PrimaryKeyDecl | CheckDecl

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
