/**
 * Columns kick/db maintains itself (D.10): `onUpdateNow()` timestamps and
 * `version()` counters are set on every UPDATE — and on an upsert's update
 * branch — that doesn't set them itself; `softDelete()` columns are read by
 * the relational compiler.
 */
import {
  AliasNode,
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
import { unwrapTable, type TableDecl } from '../dsl/table'
import type { ColumnBuilder } from '../dsl/columns/types'

export interface ManagedColumns {
  updatedAt: string[]
  version: string[]
  softDelete?: string
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
    }
    if (managed.updatedAt.length || managed.version.length || managed.softDelete) {
      out.set(t.__name, managed)
    }
  }
  return out
}

function tableName(node: OperationNode | undefined): string | undefined {
  if (!node) return undefined
  if (AliasNode.is(node)) return tableName(node.node)
  if (TableNode.is(node)) return node.table.identifier.name
  return undefined
}

/** What to qualify a column with: the alias if the statement has one, else the table. */
function qualifier(node: OperationNode | undefined): string | undefined {
  if (node && AliasNode.is(node) && IdentifierNode.is(node.alias)) return node.alias.name
  return tableName(node)
}

/** `updates` plus a SET for each managed column they don't already set. */
function withManaged(
  updates: ReadonlyArray<ColumnUpdateNode>,
  managed: ManagedColumns,
  table: string,
): ReadonlyArray<ColumnUpdateNode> {
  const set = new Set(
    updates.map((u) => (ColumnNode.is(u.column) ? u.column.column.name : undefined)),
  )
  const extra: ColumnUpdateNode[] = []
  for (const col of managed.updatedAt) {
    if (!set.has(col))
      extra.push(ColumnUpdateNode.create(ColumnNode.create(col), ValueNode.create(new Date())))
  }
  for (const col of managed.version) {
    if (!set.has(col)) {
      extra.push(
        ColumnUpdateNode.create(
          ColumnNode.create(col),
          BinaryOperationNode.create(
            // Qualified: in an upsert's update branch a bare name is ambiguous
            // between the stored row and the incoming one on Postgres.
            ReferenceNode.create(ColumnNode.create(col), TableNode.create(table)),
            OperatorNode.create('+'),
            ValueNode.createImmediate(1),
          ),
        ),
      )
    }
  }
  return extra.length ? [...updates, ...extra] : updates
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
      // An upsert's update branch is an update too.
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
    }
    return node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result
  }
}
