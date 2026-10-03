/**
 * `casing: 'snake_case'`: keys in TypeScript stay camelCase while the
 * database's tables and columns are snake_case. The snapshot (and so every
 * migration) is written in the database's names; at runtime Kysely's
 * CamelCasePlugin converts between the two. Both sides use the plugin's own
 * conversion, so they can't disagree.
 */
import {
  CamelCasePlugin,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from 'kysely'
import { derivedFkName, derivedUniqueName } from './name'
import type { IndexSnapshot, SchemaSnapshot, TableSnapshot } from './types'

export type Casing = 'snake_case'

class Conversions extends CamelCasePlugin {
  toDb(name: string): string {
    return this.snakeCase(name)
  }
  toKey(name: string): string {
    return this.camelCase(name)
  }
}

const conversions = new Conversions()

/** A TypeScript key as the database names it: `firstName` → `first_name`. */
export const toDbName = (key: string): string => conversions.toDb(key)

/** A database name as a TypeScript key: `first_name` → `firstName`. */
export const toKeyName = (name: string): string => conversions.toKey(name)

/**
 * The snapshot with every table and column in the database's names. Names
 * kick/db derived from keys (`<table>_<column>_unique`, `_fk`) are derived
 * again from the new names; names written in the schema are kept, as is SQL
 * (checks, predicates, expressions) — that is written for the database already.
 */
export function applyCasing(snapshot: SchemaSnapshot): SchemaSnapshot {
  return renameSnapshot(snapshot, toDbName)
}

/** The other way: a database's snapshot in TypeScript keys — for `kick db introspect`. */
export function removeCasing(snapshot: SchemaSnapshot): SchemaSnapshot {
  return renameSnapshot(snapshot, toKeyName)
}

function renameSnapshot(
  snapshot: SchemaSnapshot,
  rename: (name: string) => string,
): SchemaSnapshot {
  // Every part, schema included: Kysely's CamelCasePlugin converts a schema
  // name in a query the same way, so `pgSchema('billingApp')` is `billing_app`.
  const tableName = (qualified: string) => qualified.split('.').map(rename).join('.')
  const col = (c: string) => (c.startsWith('(') ? c : rename(c))

  const tables: Record<string, TableSnapshot> = {}
  for (const [key, t] of Object.entries(snapshot.tables)) {
    const name = rename(t.name)
    const columns: TableSnapshot['columns'] = {}
    for (const c of Object.values(t.columns)) columns[col(c.name)] = { ...c, name: col(c.name) }

    const indexes = t.indexes.map((i): IndexSnapshot => {
      const derived =
        i.unique && i.columns.length === 1 && i.name === derivedUniqueName(t.name, i.columns[0])
      const out: IndexSnapshot = {
        ...i,
        name: derived ? derivedUniqueName(name, col(i.columns[0])) : i.name,
        columns: i.columns.map(col),
      }
      if (i.include) out.include = i.include.map(col)
      if (i.opclasses) {
        out.opclasses = Object.fromEntries(Object.entries(i.opclasses).map(([k, v]) => [col(k), v]))
      }
      return out
    })
    const foreignKeys = t.foreignKeys.map((f) => ({
      ...f,
      name:
        f.columns.length === 1 && f.name === derivedFkName(t.name, f.columns[0])
          ? derivedFkName(name, col(f.columns[0]))
          : f.name,
      columns: f.columns.map(col),
      refTable: tableName(f.refTable),
      refColumns: f.refColumns.map(col),
    }))

    const next: TableSnapshot = { ...t, name, columns, indexes, foreignKeys }
    if (t.schema !== undefined) next.schema = rename(t.schema)
    if (t.primaryKey) next.primaryKey = { ...t.primaryKey, columns: t.primaryKey.columns.map(col) }
    tables[tableName(key)] = next
  }
  const renamed: SchemaSnapshot = { ...snapshot, tables }
  if (snapshot.schemas) renamed.schemas = snapshot.schemas.map(rename).toSorted()
  return renamed
}

/**
 * The client half of `casing`, as two plugins. Kysely runs query and result
 * transforms in plugin order, and the conversion has to come last on the way
 * out (after managed columns and codecs have added and encoded by key) but
 * first on the way back (before codecs decode by key). So one plugin goes at
 * each end of the chain.
 *
 * Results are converted here rather than by CamelCasePlugin, which renames
 * keys at every depth — including inside a JSON column's value, which is the
 * user's data. Only a row's own keys are renamed, and the rows `db.query`
 * nests under a relation name. (On SQLite and MySQL those nested rows arrive
 * as JSON text already keyed by the selected names, which are camelCase.)
 */
export function casingPlugins(relationKeys: ReadonlySet<string>): {
  first: KyselyPlugin
  last: KyselyPlugin
} {
  const plugin = new CamelCasePlugin()
  const convert = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      const key = toKeyName(k)
      out[key] = relationKeys.has(key) ? convertNested(v) : v
    }
    return out
  }
  const convertNested = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convertNested)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return convert(value as Record<string, unknown>)
    }
    return value
  }
  return {
    first: {
      transformQuery: (args: PluginTransformQueryArgs): RootOperationNode => args.node,
      transformResult: async (args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> =>
        args.result.rows
          ? { ...args.result, rows: args.result.rows.map((r) => convert(r) as UnknownRow) }
          : args.result,
    },
    last: {
      transformQuery: (args: PluginTransformQueryArgs): RootOperationNode =>
        plugin.transformQuery(args),
      transformResult: async (args: PluginTransformResultArgs) => args.result,
    },
  }
}
