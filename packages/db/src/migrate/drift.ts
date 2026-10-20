import { diff } from '../diff/engine'
import type { Change } from '../diff/types'
import type {
  ColumnSnapshot,
  Dialect,
  ForeignKeySnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '../snapshot/types'
import { sqliteType } from '../emit/sqlite'
import { mysqlType } from '../emit/mysql'
import { MigrationDriftError, type SchemaDiffSummary } from './errors'
import { normalizeDefault } from './introspect-pg'
import { formatDefault } from '../emit/pg'

/**
 * SQLite and MySQL introspection is lossy against a code-first snapshot: a
 * `uuid()` column reads back as `text` / `char(36)`, default expressions
 * store in a normalised form, and SQLite doesn't preserve FK names.
 * Comparing the raw snapshots would flag drift on every migration.
 *
 * To get meaningful drift on those dialects we canonicalise BOTH sides
 * into the same shape before diffing: column types run through the emit
 * type-mapper (so `uuid` and `text` collapse together), defaults are
 * dropped (too divergent to align reliably), and FK names become a
 * structural key. This still catches the drift that matters — tables /
 * columns added or removed, type / nullability / PK changes, indexes —
 * without false positives. PostgreSQL round-trips faithfully, so it is
 * compared raw and keeps default-level drift detection.
 */
function normalizeForDrift(snap: SchemaSnapshot): SchemaSnapshot {
  // Roles aren't introspected (a server has many this schema doesn't know),
  // and Postgres rewrites a policy's expressions, so drift compares policies
  // by name, command, kind and roles.
  const { roles: _roles, ...withoutRoles } = snap
  snap = {
    ...withoutRoles,
    tables: Object.fromEntries(
      Object.entries(snap.tables).map(([n, table]) => {
        // Introspection can't tell a `.defaultSql()` from a `.default()`: the
        // database holds only the expression. Compare the defaults themselves.
        const t: TableSnapshot = {
          ...table,
          columns: Object.fromEntries(
            Object.entries(table.columns).map(([cn, { defaultSql, defaultRaw, ...c }]) => {
              if (snap.dialect !== 'postgres' || c.default === null) return [cn, c]
              // The SQL each side means: what Postgres reports for the live
              // column, what the migration emitted for the snapshot's.
              const sql = defaultRaw ?? formatDefault(c.default, c.type, defaultSql)
              const value =
                defaultSql && typeof c.default === 'string'
                  ? pgDefaultSqlForDrift(c.default)
                  : c.default
              // Normalised values alone can't tell the literal `'(f())'::text`
              // from the expression `(f())::text`; the kind can.
              return [cn, { ...c, default: `${isPgLiteral(sql) ? 'value' : 'sql'}:${value}` }]
            }),
          ),
        }
        return [
          n,
          t.policies
            ? {
                ...t,
                policies: t.policies.map(({ using: _u, withCheck: _w, ...p }) => ({
                  ...p,
                  to: [...p.to].toSorted(),
                })),
              }
            : t,
        ]
      }),
    ),
  }
  // A view's SQL comes back rewritten by the database (Postgres reformats it,
  // MySQL qualifies every name), so drift compares which views exist.
  if (snap.views) {
    snap = {
      ...snap,
      views: Object.fromEntries(
        Object.entries(snap.views).map(([n, v]) => [
          n,
          { name: v.name, definition: '', ...(v.materialized ? { materialized: true } : {}) },
        ]),
      ) as SchemaSnapshot['views'],
    }
  }
  // Introspection reads neither CHECK constraints (Postgres also rewrites
  // their expressions) nor a primary key's name and declared order, so drift
  // compares key columns only and leaves CHECKs out. ponytail: introspect
  // pg_constraint / information_schema.check_constraints to cover them.
  snap = {
    ...snap,
    tables: Object.fromEntries(
      Object.entries(snap.tables).map(([n, t]) => {
        const { primaryKey: _key, ...rest } = t
        // A generated column's expression comes back rewritten by the
        // database, and only Postgres reports identity, so drift compares the
        // columns without either. ponytail: compare normalised expressions.
        const columns = Object.fromEntries(
          Object.entries(t.columns).map(([cn, { generated: _g, identity: _i, ...c }]) => [cn, c]),
        )
        // Indexes compare on name, uniqueness and plain key columns. A
        // predicate or expression comes back rewritten by the database
        // (Postgres re-quotes and re-parenthesises it; SQLite and MySQL
        // introspection don't read them), so comparing their text would flag
        // drift on every run. ponytail: normalise via pg_get_expr on both sides.
        const indexes = t.indexes.map((i) => ({
          name: i.name,
          columns: i.columns.filter((c) => !c.startsWith('(')),
          unique: i.unique,
        }))
        return [n, { ...rest, columns, indexes, checks: [] }]
      }),
    ),
  }
  if (snap.dialect === 'postgres') return snap

  const tables: Record<string, TableSnapshot> = {}
  for (const [name, t] of Object.entries(snap.tables)) {
    const columns: Record<string, ColumnSnapshot> = {}
    for (const [cn, c] of Object.entries(t.columns)) {
      columns[cn] = {
        ...c,
        type: canonicalType(c.type, snap.dialect),
        default: null,
        // A primary key is never null, whatever introspection says: SQLite
        // reports an inline `INTEGER PRIMARY KEY` (every `serial()`) as
        // nullable, which read as drift on every run after the first.
        nullable: c.primaryKey ? false : c.nullable,
      }
    }
    // InnoDB creates a non-unique index for a foreign key whose columns no
    // index leads with, named after the constraint. It isn't in the schema,
    // so it isn't drift. A unique index is always the schema's, so it stays
    // and a change to its uniqueness is still caught.
    const indexes =
      snap.dialect === 'mysql'
        ? t.indexes.filter(
            (ix) =>
              ix.unique ||
              !t.foreignKeys.some(
                (fk) => fk.name === ix.name && fk.columns.join() === ix.columns.join(),
              ),
          )
        : t.indexes
    tables[name] = { ...t, columns, indexes, foreignKeys: t.foreignKeys.map(canonicalFk) }
  }
  return { ...snap, tables }
}

function canonicalType(type: string, dialect: Dialect): string {
  if (dialect === 'sqlite') return sqliteType(type).toLowerCase()
  if (dialect === 'mysql') return mysqlType(type).toLowerCase()
  return type
}

/** Replace the FK name with a structural key (SQLite synthesizes names). */
function canonicalFk(fk: ForeignKeySnapshot): ForeignKeySnapshot {
  return {
    name: `${fk.columns.join(',')}=>${fk.refTable}(${fk.refColumns.join(',')})`,
    columns: fk.columns,
    refTable: fk.refTable,
    refColumns: fk.refColumns,
    onDelete: fk.onDelete,
    onUpdate: fk.onUpdate,
  }
}

/**
 * A Postgres `.defaultSql()` default, read the way introspection reads the
 * live one where that's safe: a cast literal (`'{}'::jsonb` comes back as
 * `{}`) and a cast-free expression (`now()` as `CURRENT_TIMESTAMP`). A cast
 * expression stays as written — normalising `gen_random_uuid()::text` would
 * make it equal the literal `'gen_random_uuid()'::text`, a different default.
 * Postgres reports it as `(gen_random_uuid())::text`, so it reads as drift.
 * ponytail: compare against the raw column_default to match cast expressions.
 */
function pgDefaultSqlForDrift(sql: string): string | null {
  return isPgLiteral(sql) || !sql.includes('::') ? normalizeDefault(sql) : sql
}

/** Trailing casts: `::jsonb`, `::character varying(20)`, `::text[]`, `::"status"`. */
const PG_CASTS = /(?:::[\w" .]+(?:\([^)]*\))?(?:\[\])*)+$/

/**
 * A default that is a constant: a quoted string (`::` inside it is text), a
 * number, `true` / `false` / `NULL`, with or without casts. Anything else is
 * an expression Postgres evaluates on insert.
 */
function isPgLiteral(sql: string): boolean {
  const bare = /^'(?:[^']|'')*'$/.test(sql) ? sql : sql.replace(PG_CASTS, '')
  return (
    /^'(?:[^']|'')*'$/.test(bare) ||
    /^\(?-?\d+(?:\.\d+)?\)?$/.test(bare) ||
    /^(?:true|false|null)$/i.test(bare)
  )
}

export type DriftBehavior = 'error' | 'warn' | 'ignore'

/**
 * What the drift check leaves out, matched by name on both sides — say the
 * indexes an app creates at runtime: `{ indexes: /^ix_e_/ }`.
 */
export interface DriftIgnore {
  tables?: RegExp
  indexes?: RegExp
}

/** The snapshot without the tables and indexes `ignore` names. */
function withoutIgnored(snap: SchemaSnapshot, ignore: DriftIgnore): SchemaSnapshot {
  // Copies without `g` / `y`: those keep lastIndex between test() calls, so the
  // same name could match on one side and not the other.
  const plain = (re?: RegExp) => re && new RegExp(re.source, re.flags.replace(/[gy]/g, ''))
  const tablesRe = plain(ignore.tables)
  const indexesRe = plain(ignore.indexes)
  const tables: Record<string, TableSnapshot> = {}
  for (const [name, t] of Object.entries(snap.tables)) {
    if (tablesRe?.test(name)) continue
    tables[name] = indexesRe
      ? { ...t, indexes: t.indexes.filter((ix) => !indexesRe.test(ix.name)) }
      : t
  }
  return { ...snap, tables }
}

export interface DriftLogger {
  warn: (message: string) => void
}

export async function checkDrift(
  liveSnapshot: SchemaSnapshot,
  expectedSnapshot: SchemaSnapshot,
  behavior: DriftBehavior,
  log: DriftLogger = console,
  ignore?: DriftIgnore,
): Promise<void> {
  if (behavior === 'ignore') return
  if (ignore) {
    liveSnapshot = withoutIgnored(liveSnapshot, ignore)
    expectedSnapshot = withoutIgnored(expectedSnapshot, ignore)
  }
  // diff(prev, next) reads expected as `prev` and live as `next` so 'added'
  // means "live has it but the snapshot doesn't" — i.e. someone ran DDL
  // outside the migration runner. Both sides are canonicalised first so
  // SQLite/MySQL's lossy introspection doesn't flag phantom drift.
  const changes = diff(normalizeForDrift(expectedSnapshot), normalizeForDrift(liveSnapshot))
  if (changes.length === 0) return

  const summary = summarize(changes)
  const named = (['added', 'removed', 'changed'] as const)
    .filter((k) => summary[k].length > 0)
    .map((k) => `${k}: ${summary[k].join(', ')}`)
    .join('; ')
  const message = `Schema drift detected: ${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed (${named})`
  if (behavior === 'warn') {
    log.warn(message)
    return
  }
  throw new MigrationDriftError(message, summary)
}

function summarize(changes: Change[]): SchemaDiffSummary {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const c of changes) {
    switch (c.kind) {
      case 'createTable':
        added.push(c.table.name)
        break
      case 'createView':
        added.push(`view ${c.view.name}`)
        break
      case 'createPolicy':
        added.push(`${c.table} policy ${c.policy.name}`)
        break
      case 'dropPolicy':
        removed.push(`${c.table} policy ${c.policy.name}`)
        break
      case 'setRowLevelSecurity':
        changed.push(`${c.table}#rowLevelSecurity`)
        break
      case 'dropView':
        removed.push(`view ${c.view.name}`)
        break
      case 'dropTable':
        removed.push(c.table.name)
        break
      case 'addColumn':
        added.push(`${c.table}.${c.column.name}`)
        break
      case 'dropColumn':
        removed.push(`${c.table}.${c.column.name}`)
        break
      case 'alterColumn':
        changed.push(`${c.table}.${c.column}`)
        break
      case 'alterPrimaryKey':
        // A key change arrives as a drop-then-add pair; name the table once.
        if (!changed.includes(`${c.table}#primaryKey`)) changed.push(`${c.table}#primaryKey`)
        break
      case 'renameColumn':
        changed.push(`${c.table}.${c.from}→${c.to}`)
        break
      case 'renameTable':
        changed.push(`${c.from}→${c.to}`)
        break
      case 'addIndex':
        added.push(`${c.table}#${c.index.name}`)
        break
      case 'dropIndex':
        removed.push(`${c.table}#${c.index.name}`)
        break
      case 'addForeignKey':
        added.push(`${c.table}!${c.fk.name}`)
        break
      case 'dropForeignKey':
        removed.push(`${c.table}!${c.fk.name}`)
        break
    }
  }
  return { added, removed, changed }
}
