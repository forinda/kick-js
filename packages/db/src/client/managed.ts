/**
 * Columns kick/db maintains itself (D.10): `onUpdateNow()` timestamps and
 * `version()` counters are set on every UPDATE — and on an upsert's update
 * branch — that doesn't set them itself; `softDelete()` columns are read by
 * the relational compiler.
 */
import {
  AliasNode,
  DefaultInsertValueNode,
  PrimitiveValueListNode,
  ValueListNode,
  ValuesNode,
  BinaryOperationNode,
  ColumnNode,
  ColumnUpdateNode,
  IdentifierNode,
  InsertQueryNode,
  OperatorNode,
  ReferenceNode,
  TableNode,
  UpdateQueryNode,
  ValueNode,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from 'kysely'
import { qualifiedTableName, unwrapTable, type TableDecl } from '../dsl/table'
import type { ColumnBuilder } from '../dsl/columns/types'

export interface ManagedColumns {
  updatedAt: string[]
  version: string[]
  softDelete?: string
  /** `$defaultFn` columns: filled in on insert. */
  insertDefaults?: Array<[string, () => unknown]>
  /** `$onUpdate` columns: set on update. */
  updateValues?: Array<[string, () => unknown]>
}

/** Every table's managed columns, by table name. Tables with none are absent. */
export function collectManaged(schema: unknown): Map<string, ManagedColumns> {
  const out = new Map<string, ManagedColumns>()
  if (!schema || typeof schema !== 'object') return out
  for (const exported of Object.values(schema as Record<string, unknown>)) {
    const t = unwrapTable(exported) as TableDecl<string, Record<string, ColumnBuilder>> | null
    if (!t || (t as { __isTable?: boolean }).__isTable !== true) continue
    const managed: ManagedColumns = { updatedAt: [], version: [] }
    for (const [name, col] of Object.entries(t.__columns)) {
      const role = col.managedAs?.()
      if (role === 'updatedAt') managed.updatedAt.push(name)
      else if (role === 'version') managed.version.push(name)
      else if (role === 'softDelete') managed.softDelete = name
      const state = col.__state?.()
      if (state?.defaultFn) (managed.insertDefaults ??= []).push([name, state.defaultFn])
      if (state?.onUpdateFn) (managed.updateValues ??= []).push([name, state.onUpdateFn])
    }
    if (
      managed.updatedAt.length ||
      managed.version.length ||
      managed.softDelete ||
      managed.insertDefaults ||
      managed.updateValues
    ) {
      // Keyed like the snapshot — `billing.invoices` for a table in a named schema.
      out.set(qualifiedTableName(t), managed)
    }
  }
  return out
}

/** The statement's table as the managed map keys it: `schema.table`, or `table`. */
function tableName(node: OperationNode | undefined): string | undefined {
  if (!node) return undefined
  if (AliasNode.is(node)) return tableName(node.node)
  if (TableNode.is(node)) {
    const { schema, identifier } = node.table
    return schema ? `${schema.name}.${identifier.name}` : identifier.name
  }
  return undefined
}

/** What to qualify a column with: the alias if the statement has one, else the (schema-qualified) table. */
function qualifier(node: OperationNode | undefined): TableNode | undefined {
  if (!node) return undefined
  if (AliasNode.is(node) && IdentifierNode.is(node.alias)) return TableNode.create(node.alias.name)
  if (AliasNode.is(node)) return qualifier(node.node)
  return TableNode.is(node) ? node : undefined
}

/** `updates` plus a SET for each managed column they don't already set. */
function withManaged(
  updates: ReadonlyArray<ColumnUpdateNode>,
  managed: ManagedColumns,
  table: TableNode,
): ReadonlyArray<ColumnUpdateNode> {
  const set = new Set(
    updates.map((u) => (ColumnNode.is(u.column) ? u.column.column.name : undefined)),
  )
  const extra: ColumnUpdateNode[] = []
  for (const col of managed.updatedAt) {
    if (!set.has(col))
      extra.push(ColumnUpdateNode.create(ColumnNode.create(col), ValueNode.create(new Date())))
  }
  for (const [col, fn] of managed.updateValues ?? []) {
    if (!set.has(col))
      extra.push(ColumnUpdateNode.create(ColumnNode.create(col), ValueNode.create(fn())))
  }
  for (const col of managed.version) {
    if (!set.has(col)) {
      extra.push(
        ColumnUpdateNode.create(
          ColumnNode.create(col),
          BinaryOperationNode.create(
            // Qualified: in an upsert's update branch a bare name is ambiguous
            // between the stored row and the incoming one on Postgres.
            ReferenceNode.create(ColumnNode.create(col), table),
            OperatorNode.create('+'),
            ValueNode.createImmediate(1),
          ),
        ),
      )
    }
  }
  return extra.length ? [...updates, ...extra] : updates
}

/**
 * `node` with each `$defaultFn` column the insert doesn't list added, and its
 * value computed for every row. Inserts from a SELECT are left alone.
 */
function withInsertDefaults(node: InsertQueryNode, m: ManagedColumns): InsertQueryNode {
  if (!m.insertDefaults || !node.columns || !node.values || !ValuesNode.is(node.values)) return node
  const listed = node.columns.map((c) => c.column.name)
  const missing = m.insertDefaults.filter(([col]) => !listed.includes(col))
  // A listed column a row leaves out (a multi-row insert lists every row's
  // keys) holds DEFAULT in that row; it gets the computed value too.
  const listedFns = new Map(
    m.insertDefaults
      .filter(([col]) => listed.includes(col))
      .map(([col, fn]) => [listed.indexOf(col), fn] as const),
  )
  if (missing.length === 0 && listedFns.size === 0) return node
  const rows = node.values.values.map((row) => {
    if (PrimitiveValueListNode.is(row)) {
      return PrimitiveValueListNode.create([...row.values, ...missing.map(([, fn]) => fn())])
    }
    const values = row.values.map((v, i) => {
      const fn = listedFns.get(i)
      return fn && DefaultInsertValueNode.is(v) ? ValueNode.create(fn()) : v
    })
    return ValueListNode.create([...values, ...missing.map(([, fn]) => ValueNode.create(fn()))])
  })
  return {
    ...node,
    columns: [...node.columns, ...missing.map(([col]) => ColumnNode.create(col))],
    values: ValuesNode.create(rows),
  }
}

export class ManagedColumnsPlugin implements KyselyPlugin {
  constructor(private readonly managed: Map<string, ManagedColumns>) {}

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const node = args.node
    if (UpdateQueryNode.is(node) && node.updates?.length) {
      const m = this.managed.get(tableName(node.table) ?? '')
      if (m) return { ...node, updates: withManaged(node.updates, m, qualifier(node.table)!) }
      return node
    }
    if (InsertQueryNode.is(node)) {
      const m = this.managed.get(tableName(node.into) ?? '')
      if (!m) return node
      return this.withUpsertUpdates(withInsertDefaults(node, m), m)
    }
    return node
  }

  /** An upsert's update branch is an update too. */
  private withUpsertUpdates(node: InsertQueryNode, m: ManagedColumns): InsertQueryNode {
    if (node.onConflict?.updates?.length) {
      return {
        ...node,
        onConflict: {
          ...node.onConflict,
          updates: withManaged(node.onConflict.updates, m, qualifier(node.into)!),
        },
      }
    }
    if (node.onDuplicateKey?.updates?.length) {
      return {
        ...node,
        onDuplicateKey: {
          ...node.onDuplicateKey,
          updates: withManaged(node.onDuplicateKey.updates, m, qualifier(node.into)!),
        },
      }
    }
    return node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result
  }
}
