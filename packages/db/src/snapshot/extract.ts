import type { ColumnBuilder } from '../dsl/columns/types'
import { qualifiedTableName, type TableDecl } from '../dsl/table'
import { extractRelations } from '../query/extract-relations'
import type {
  Dialect,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
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

export function extractSnapshot(schema: Record<string, unknown>, dialect: Dialect): SchemaSnapshot {
  const tables: Record<string, TableSnapshot> = {}
  const enums: Record<string, EnumSnapshot> = {}

  const schemaNames = new Set<string>()

  for (const value of Object.values(schema)) {
    if (isTable(value)) {
      // Key by qualified name so two schemas can hold same-named tables
      // without the later one silently overwriting the earlier.
      tables[qualifiedTableName(value)] = extractTable(value)
      if (value.__schema !== undefined) schemaNames.add(value.__schema)
    } else if (isPgEnum(value)) {
      enums[value.enumName] = { name: value.enumName, values: [...value.values] }
    }
  }

  assertSchemasSupported(dialect, schemaNames)

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
  return snapshot
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
        name: `${t.__name}_${colKey}_unique`,
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
        // the database. Only derive when the schema didn't say.
        name: state.references.name ?? `${t.__name}_${colKey}_fk`,
        columns: [colKey],
        refTable: ref.__tableName,
        refColumns: [ref.__name],
        onDelete: state.references.onDelete,
        onUpdate: state.references.onUpdate,
      })
    }
  }

  const snapshot: TableSnapshot = { name: t.__name, columns, indexes, foreignKeys, checks: [] }
  // Only present the key when a schema was declared — an explicit
  // `schema: undefined` would change the serialized JSON and invalidate
  // every existing migration hash.
  if (t.__schema !== undefined) snapshot.schema = t.__schema
  return snapshot
}
