/**
 * Query side of tenancy: `'column'` adds the tenant to every query on a
 * tenanted table and fills it on insert; `'schema'` points each query at the
 * tenant's schema. (`'rls'` works on connections, in tenancy-connections.ts.)
 */
import {
  AliasNode,
  BinaryOperationNode,
  ColumnNode,
  DefaultInsertValueNode,
  DeleteQueryNode,
  IdentifierNode,
  InsertQueryNode,
  JoinNode,
  OperationNodeTransformer,
  OperatorNode,
  PrimitiveValueListNode,
  ReferenceNode,
  SelectQueryNode,
  TableNode,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
  WhereNode,
  WithSchemaPlugin,
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
import { TenantRequiredError, type Tenancy } from '../tenancy'

/** Tenanted tables → their tenant column, keyed like the snapshot. */
export function collectTenantColumns(schema: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!schema || typeof schema !== 'object') return out
  for (const exported of Object.values(schema as Record<string, unknown>)) {
    const t = unwrapTable(exported) as TableDecl<string, Record<string, ColumnBuilder>> | undefined
    if (!t) continue
    for (const [key, col] of Object.entries(t.__columns)) {
      if (col.__state().tenancy) out.set(qualifiedTableName(t), key)
    }
  }
  return out
}

/** A FROM / JOIN item's table name and the name to qualify its columns with. */
function tableOf(node: OperationNode): { table: string; ref: string } | undefined {
  if (AliasNode.is(node) && TableNode.is(node.node) && IdentifierNode.is(node.alias)) {
    return { table: nameOf(node.node), ref: node.alias.name }
  }
  if (TableNode.is(node)) return { table: nameOf(node), ref: nameOf(node) }
  return undefined
}

function nameOf(node: TableNode): string {
  const { schema, identifier } = node.table
  return schema ? `${schema.name}.${identifier.name}` : identifier.name
}

/** `<ref>.<column> = <tenant>` */
function matches(ref: string, column: string, tenant: string): OperationNode {
  const [schema, table] = ref.includes('.') ? ref.split('.') : [undefined, ref]
  return BinaryOperationNode.create(
    ReferenceNode.create(
      ColumnNode.create(column),
      schema ? TableNode.createWithSchema(schema, table!) : TableNode.create(table!),
    ),
    OperatorNode.create('='),
    ValueNode.create(tenant),
  )
}

class TenantColumnFilter extends OperationNodeTransformer {
  constructor(
    private readonly columns: Map<string, string>,
    private readonly tenant: string | undefined,
    /** False for 'rls': the database filters; only inserts are filled. */
    private readonly filter = true,
  ) {
    super()
  }

  /** The tenant to filter by, or an error when a tenanted table is used without one. */
  private need(table: string): string {
    if (this.tenant === undefined) throw new TenantRequiredError(table)
    return this.tenant
  }

  private withFilters(where: WhereNode | undefined, items: readonly OperationNode[]) {
    if (!this.filter) return where
    let out = where
    for (const item of items) {
      const t = tableOf(item)
      const column = t && this.columns.get(t.table)
      if (!t || !column) continue
      const condition = matches(t.ref, column, this.need(t.table))
      out = out ? WhereNode.cloneWithOperation(out, 'And', condition) : WhereNode.create(condition)
    }
    return out
  }

  /** A join's tenant condition goes in its ON, so a LEFT JOIN stays a left join. */
  private withJoinFilters(joins: readonly JoinNode[] | undefined) {
    if (!this.filter) return joins
    return joins?.map((join) => {
      const t = tableOf(join.table)
      const column = t && this.columns.get(t.table)
      if (!t || !column) return join
      const condition = matches(t.ref, column, this.need(t.table))
      return JoinNode.cloneWithOn(join, condition)
    })
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    const out = super.transformSelectQuery(node)
    const where = this.withFilters(out.where, out.from?.froms ?? [])
    return { ...out, ...(where ? { where } : {}), joins: this.withJoinFilters(out.joins) }
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    const out = super.transformUpdateQuery(node)
    const where = this.withFilters(out.where, out.table ? [out.table] : [])
    return { ...out, ...(where ? { where } : {}), joins: this.withJoinFilters(out.joins) }
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    const out = super.transformDeleteQuery(node)
    const where = this.withFilters(out.where, out.from.froms)
    return { ...out, ...(where ? { where } : {}), joins: this.withJoinFilters(out.joins) }
  }

  /** Fill the tenant column; refuse a row for another tenant. */
  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    const out = super.transformInsertQuery(node)
    const t = out.into ? tableOf(out.into) : undefined
    const column = t && this.columns.get(t.table)
    if (!t || !column || !out.columns || !out.values || !ValuesNode.is(out.values)) return out
    const tenant = this.need(t.table)
    const at = out.columns.findIndex((c) => c.column.name === column)
    const check = (value: unknown) => {
      if (value !== tenant) {
        throw new Error(
          `kickjs-db: can't write ${t.table}.${column} = ${String(value)} as tenant ${tenant}`,
        )
      }
    }
    const rows = out.values.values.map((row) => {
      if (PrimitiveValueListNode.is(row)) {
        if (at === -1) return PrimitiveValueListNode.create([...row.values, tenant])
        check(row.values[at])
        return row
      }
      const values = row.values.map((v, i) => {
        if (i !== at) return v
        if (DefaultInsertValueNode.is(v)) return ValueNode.create(tenant)
        if (ValueNode.is(v)) check(v.value)
        return v
      })
      return ValueListNode.create(at === -1 ? [...values, ValueNode.create(tenant)] : values)
    })
    return {
      ...out,
      columns: at === -1 ? [...out.columns, ColumnNode.create(column)] : out.columns,
      values: ValuesNode.create(rows),
    }
  }
}

/**
 * The client plugin: `'column'` filters and fills, `'rls'` only fills the
 * tenant column on insert (the policy filters), `'schema'` switches schema.
 */
export function tenancyPlugin(tenancy: Tenancy, schema: unknown): KyselyPlugin | undefined {
  // 'database' routes connections instead (tenancy-connections.ts).
  if (tenancy.strategy === 'database') return undefined
  if (tenancy.strategy === 'schema') {
    const plugins = new Map<string, WithSchemaPlugin>()
    return {
      transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        const tenant = tenancy.current()
        if (tenant === null) return args.node
        if (tenant === undefined) throw new TenantRequiredError('(any table)')
        const name = tenancy.schemaFor(tenant)
        let plugin = plugins.get(name)
        if (!plugin) plugins.set(name, (plugin = new WithSchemaPlugin(name)))
        return plugin.transformQuery(args)
      },
      async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        return args.result
      },
    }
  }
  const columns = collectTenantColumns(schema)
  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      const tenant = tenancy.current()
      if (tenant === null) return args.node
      // Under 'rls' a missing tenant is the database's to refuse (the policy
      // matches nothing), so only inserts, which need a value, require one.
      return new TenantColumnFilter(columns, tenant, tenancy.strategy === 'column').transformNode(
        args.node,
      )
    },
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return args.result
    },
  }
}
