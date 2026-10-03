import type { ColumnBuilder } from '../dsl/columns/types'
import { derivedFkName, derivedUniqueName } from './name'
import { qualifiedTableName, unwrapTable, type TableDecl } from '../dsl/table'
import { isView } from '../dsl/view'
import { isRole } from '../dsl/rls'
import { extractRelations } from '../query/extract-relations'
import { applyCasing, toDbName, type Casing } from './casing'
import type {
  Dialect,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
  RoleSnapshot,
  ViewSnapshot,
} from './types'

interface MaybeTable {
  __isTable?: boolean
  __name?: string
  __columns?: Record<string, ColumnBuilder>
  __indexes?: IndexSnapshot[]
}

function isTable(v: unknown): v is TableDecl<string, Record<string, ColumnBuilder>> {
  return Boolean(v && typeof v === 'object' && (v as MaybeTable).__isTable === true)
}

/**
 * Named schemas are a PostgreSQL-only feature here.
 *
 * The word means something different on every engine: on MySQL a "schema" IS
 * a database (different lifecycle, different privileges, no `CREATE SCHEMA
 * IF NOT EXISTS` semantics we could honour), and SQLite has no schemas at all
 * — only `ATTACH`ed database aliases, which are a connection-time concern the
 * adapter would have to own. Emitting `"billing"."invoices"` on those engines
 * would produce SQL that parses and means the wrong thing.
 *
 * So fail loudly at snapshot time, which is before any DDL is written or
 * applied.
 */
function assertSchemasSupported(dialect: Dialect, schemaNames: ReadonlySet<string>): void {
  if (dialect === 'postgres' || schemaNames.size === 0) return
  const names = [...schemaNames].toSorted().join(', ')
  throw new Error(
    `pgSchema() is PostgreSQL-only, but the ${dialect} schema declares: ${names}. ` +
      `On MySQL a schema is a database and SQLite has none, so the qualified ` +
      `identifiers would mean something different than on PG. ` +
      `Drop the pgSchema() wrapper, or move these tables to a PG dialect.`,
  )
}

/**
 * pgEnum() returns a function with `enumName` + `values` attached.
 * Detect via duck-typing rather than `instanceof` so the snapshot
 * code stays decoupled from the PG-specific module — the snapshot
 * pipeline runs for every dialect.
 */
interface MaybePgEnum {
  enumName?: unknown
  values?: unknown
}

function isPgEnum(v: unknown): v is { enumName: string; values: readonly string[] } {
  if (typeof v !== 'function') return false
  const f = v as MaybePgEnum
  return typeof f.enumName === 'string' && Array.isArray(f.values)
}

export function extractSnapshot(
  schema: Record<string, unknown>,
  dialect: Dialect,
  options: { casing?: Casing } = {},
): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {}
  const enums: Record<string, EnumSnapshot> = {}

  const schemaNames = new Set<string>()

  const views: Record<string, ViewSnapshot> = {}
  const roles: Record<string, RoleSnapshot> = {}

  for (const exported of Object.values(schema)) {
    const value = unwrapTable(exported) ?? exported
    if (isRole(value)) {
      if (!value.__existing) roles[value.__role.name] = { ...value.__role }
    } else if (isView(value)) {
      if (value.__materialized && dialect !== 'postgres') {
        throw new Error(
          `kickjs-db: '${value.__name}' is a materialized view, which only Postgres has — use view()`,
        )
      }
      const v: ViewSnapshot = { name: value.__name, definition: value.__definition }
      if (value.__materialized) {
        v.materialized = true
        if (value.__indexes.length > 0) v.indexes = [...value.__indexes]
      }
      views[qualifiedTableName(value)] = v
    } else if (isTable(value)) {
      // Key by qualified name so two schemas can hold same-named tables
      // without the later one silently overwriting the earlier.
      tables[qualifiedTableName(value)] = extractTable(value)
      if (value.__schema !== undefined) schemaNames.add(value.__schema)
    } else if (isPgEnum(value)) {
      enums[value.enumName] = { name: value.enumName, values: [...value.values] }
    }
  }

  assertSchemasSupported(dialect, schemaNames)
  for (const t of Object.values(tables)) assertIndexesSupported(dialect, t)
  if (dialect !== 'postgres') {
    for (const t of Object.values(tables)) {
      for (const c of Object.values(t.columns)) {
        if (c.identity) {
          throw new Error(
            `kickjs-db: column '${t.name}.${c.name}' is an identity column, which only Postgres has — use serial()`,
          )
        }
      }
    }
  }

  if (dialect !== 'postgres') {
    const rlsTable = Object.values(tables).find((t) => t.rls || t.policies)
    if (rlsTable || Object.keys(roles).length > 0) {
      throw new Error(
        `kickjs-db: row-level security, policies and pgRole() are Postgres-only` +
          (rlsTable ? ` (table '${rlsTable.name}')` : ''),
      )
    }
  }

  // SQLite stores no comments; keeping them would make migrations that do nothing.
  if (dialect === 'sqlite') {
    for (const t of Object.values(tables)) {
      delete t.comment
      for (const c of Object.values(t.columns)) delete c.comment
    }
  }

  addTenantPolicies(schema, tables, dialect, options.casing)

  const relations = extractRelations(schema, tables)

  // Only carry `enums` on PG snapshots — other dialects don't define
  // them and an empty record would just bloat the diff output.
  // `relations` is dialect-agnostic (query-time sugar) but we still
  // omit it when absent to keep snapshots minimal for adopters who
  // don't use the relational query layer.
  const snapshot: SchemaSnapshot = { version: 1, dialect, tables }
  if (schemaNames.size > 0) {
    // Sorted so snapshot JSON — and therefore the migration hash — does not
    // depend on ESM namespace iteration order.
    snapshot.schemas = [...schemaNames].toSorted()
  }
  if (dialect === 'postgres' && Object.keys(enums).length > 0) {
    snapshot.enums = enums
  }
  if (relations) {
    snapshot.relations = relations
  }
  // Absent when empty, so snapshots without views — and their migration
  // hashes — are unchanged.
  if (Object.keys(views).length > 0) snapshot.views = views
  if (Object.keys(roles).length > 0) snapshot.roles = roles
  return options.casing === 'snake_case' ? applyCasing(snapshot) : snapshot
}

/**
 * A table whose `tenantKey()` uses `'rls'` tenancy gets row-level security,
 * forced, and a policy matching the column to the tenancy's setting — unless
 * it declares one with the same name itself.
 */
function addTenantPolicies(
  schema: Record<string, unknown>,
  tables: Record<string, TableSnapshot>,
  dialect: Dialect,
  casing: Casing | undefined,
): void {
  for (const exported of Object.values(schema)) {
    const t = unwrapTable(exported)
    if (!t || isView(t)) continue
    for (const [key, builder] of Object.entries(t.__columns)) {
      const tenancy = builder.__state().tenancy
      if (tenancy?.strategy !== 'rls') continue
      if (dialect !== 'postgres') {
        throw new Error(`kickjs-db: 'rls' tenancy is Postgres-only (table '${t.__name}')`)
      }
      const snap = tables[qualifiedTableName(t)]!
      const column = casing === 'snake_case' ? toDbName(key) : key
      const name = `${t.__name}_tenant`
      if (snap.policies?.some((p) => p.name === name)) continue
      const matches = `"${column.replace(/"/g, '""')}" = nullif(current_setting('${tenancy.setting.replace(/'/g, "''")}', true), '')::${snap.columns[key]!.type}`
      snap.rls = { force: true, ...snap.rls }
      snap.policies = [
        ...(snap.policies ?? []),
        {
          name,
          as: 'permissive',
          command: 'all',
          to: ['public'],
          using: matches,
          withCheck: matches,
        },
      ]
    }
  }
}

function extractTable(t: TableDecl<string, Record<string, ColumnBuilder>>): TableSnapshot {
  const columns: TableSnapshot['columns'] = {}
  const indexes: IndexSnapshot[] = [...t.__indexes]
  const foreignKeys: ForeignKeySnapshot[] = []

  for (const [colKey, builder] of Object.entries(t.__columns)) {
    columns[colKey] = builder.toJSON(colKey)
    const state = builder.__state()
    if (state.unique) {
      indexes.push({
        name: derivedUniqueName(t.__name, colKey),
        columns: [colKey],
        unique: true,
      })
    }
    if (state.references) {
      // Resolve the FK thunk lazily — by extract time the table const has
      // been bound, so self-references (`() => self.id`) work.
      const ref = state.references.thunk()
      foreignKeys.push({
        // An explicit name wins — it is the constraint that actually exists in
        // the database. Only derive when the schema didn't say, and derive
        // through the helper so a long one is shortened the same way the
        // renderer expects to see it.
        name: state.references.name ?? derivedFkName(t.__name, colKey),
        columns: [colKey],
        refTable: ref.__tableName,
        refColumns: [ref.__name],
        onDelete: state.references.onDelete,
        onUpdate: state.references.onUpdate,
      })
    }
  }

  const checks = (t.__checks ?? []).map((c) => ({ name: c.name, expression: c.expression }))
  const snapshot: TableSnapshot = { name: t.__name, columns, indexes, foreignKeys, checks }
  if (t.__comment !== undefined) snapshot.comment = t.__comment
  if (t.__rls) snapshot.rls = { ...t.__rls }
  if (t.__policies?.length) snapshot.policies = t.__policies.map((p) => ({ ...p, to: [...p.to] }))
  if (t.__primaryKey) {
    for (const c of t.__primaryKey.columns) {
      // A key column can't be null; the database enforces it either way.
      columns[c] = { ...columns[c]!, primaryKey: true, nullable: false }
    }
    snapshot.primaryKey = t.__primaryKey.name
      ? { name: t.__primaryKey.name, columns: [...t.__primaryKey.columns] }
      : { columns: [...t.__primaryKey.columns] }
  }
  // Only present the key when a schema was declared — an explicit
  // `schema: undefined` would change the serialized JSON and invalidate
  // every existing migration hash.
  if (t.__schema !== undefined) snapshot.schema = t.__schema
  return snapshot
}

/** Index options a dialect can't express — refused at extract, before any SQL is written. */
const UNSUPPORTED_INDEX_OPTIONS: Record<Dialect, (keyof IndexSnapshot)[]> = {
  postgres: [],
  mysql: ['where', 'include', 'opclasses', 'concurrently'],
  sqlite: ['using', 'include', 'opclasses', 'concurrently'],
}

function assertIndexesSupported(dialect: Dialect, t: TableSnapshot): void {
  for (const idx of t.indexes) {
    for (const option of UNSUPPORTED_INDEX_OPTIONS[dialect]) {
      if (idx[option] !== undefined) {
        const call = option === 'opclasses' ? 'op' : option
        throw new Error(
          `kickjs-db: index '${idx.name}' on '${t.name}' uses ${call}(), which ${dialect} doesn't support`,
        )
      }
    }
    if (dialect === 'mysql' && idx.using && !['btree', 'hash'].includes(idx.using.toLowerCase())) {
      throw new Error(
        `kickjs-db: index '${idx.name}' on '${t.name}' uses using('${idx.using}'); MySQL takes 'btree' or 'hash'`,
      )
    }
  }
}
