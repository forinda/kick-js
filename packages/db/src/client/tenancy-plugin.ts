/**
 * Query side of tenancy: `'column'` adds the tenant to every query on a
 * tenanted table and fills it on insert; `'schema'` points each query at the
 * tenant's schema. (`'rls'` works on connections, in tenancy-connections.ts.)
 */
import {
  AliasNode,
  BinaryOperationNode,
  ColumnNode,
  ColumnUpdateNode,
  DefaultInsertValueNode,
  DeleteQueryNode,
  IdentifierNode,
  InsertQueryNode,
  JoinNode,
  ListNode,
  MergeQueryNode,
  OperationNodeTransformer,
  OperatorNode,
  PrimitiveValueListNode,
  RawNode,
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

/** A tenanted table's tenant column: its key, and whether it holds integers. */
export interface TenantColumn {
  name: string
  integer: boolean
}

/** Tenanted tables → their tenant column, keyed like the snapshot. */
export function collectTenantColumns(schema: unknown): Map<string, TenantColumn> {
  const out = new Map<string, TenantColumn>()
  if (!schema || typeof schema !== 'object') return out
  for (const exported of Object.values(schema as Record<string, unknown>)) {
    const t = unwrapTable(exported) as TableDecl<string, Record<string, ColumnBuilder>> | undefined
    if (!t) continue
    for (const [key, col] of Object.entries(t.__columns)) {
      const state = col.__state()
      if (state.tenancy) {
        out.set(qualifiedTableName(t), { name: key, integer: /int|serial/i.test(state.type) })
      }
    }
  }
  return out
}

/**
 * A table, or a raw node that is only a table's name: `sql.table('tasks')`,
 * `sql.id('tasks')`, `sql.id('main', 'tasks')`.
 */
function tableNodeOf(node: OperationNode): TableNode | undefined {
  if (TableNode.is(node)) return node
  if (!RawNode.is(node)) return undefined
  const { parameters: params, sqlFragments: parts } = node
  if (params.length === 1 && TableNode.is(params[0]) && parts.every((f) => f.trim() === '')) {
    return params[0]
  }
  const ids = params.filter(IdentifierNode.is)
  const dotted = parts.every((f, i) => f.trim() === (i === 0 || i === parts.length - 1 ? '' : '.'))
  if (ids.length === params.length && dotted && (ids.length === 1 || ids.length === 2)) {
    return ids.length === 1
      ? TableNode.create(ids[0]!.name)
      : TableNode.createWithSchema(ids[0]!.name, ids[1]!.name)
  }
  return undefined
}

/** A FROM / JOIN item's table name and the name to qualify its columns with. */
function tableOf(node: OperationNode): { table: string; ref: string } | undefined {
  if (AliasNode.is(node) && IdentifierNode.is(node.alias)) {
    const t = tableNodeOf(node.node)
    return t ? { table: nameOf(t), ref: node.alias.name } : undefined
  }
  const t = tableNodeOf(node)
  return t ? { table: nameOf(t), ref: nameOf(t) } : undefined
}

/**
 * The names a raw FROM item mentions that `tableOf` can't see into: tables
 * and identifiers among its parameters, and the words of its own SQL text
 * (`` sql`tasks` ``, `sql.raw('tasks')`).
 */
function rawNames(node: OperationNode): string[] {
  const raw = AliasNode.is(node) ? node.node : node
  if (!RawNode.is(raw) || tableNodeOf(raw)) return []
  const words = raw.sqlFragments.flatMap(
    (f) => f.match(/[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?/g) ?? [],
  )
  return [
    ...words,
    ...raw.parameters.flatMap((p) => {
      const t = tableNodeOf(p)
      return t ? [nameOf(t)] : identifiersIn(p)
    }),
  ]
}

/**
 * Every identifier a node holds, however deep — `sql.ref('tasks')`, a table,
 * a nested raw node — except inside a query, which the filter rewrites itself.
 */
function identifiersIn(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as OperationNode
  if (
    SelectQueryNode.is(n) ||
    UpdateQueryNode.is(n) ||
    DeleteQueryNode.is(n) ||
    InsertQueryNode.is(n)
  ) {
    return []
  }
  if (IdentifierNode.is(n)) return [n.name]
  if (RawNode.is(n)) return rawNames(n)
  return Object.values(node).flatMap(identifiersIn)
}

/** MySQL's multi-table `UPDATE a, b` puts a list where the table goes. */
function itemsOf(node: OperationNode | undefined): readonly OperationNode[] {
  if (!node) return []
  return ListNode.is(node) ? node.items : [node]
}

/** The column a SET assigns, by name (`title` or `tasks.title`). */
function updatedColumn(update: ColumnUpdateNode): string | undefined {
  const c = update.column
  if (ColumnNode.is(c)) return c.column.name
  if (ReferenceNode.is(c) && ColumnNode.is(c.column)) return c.column.column.name
  return undefined
}

/**
 * The same column name: SQLite and MySQL match names case-insensitively, so
 * `TENANTID` is the tenant column too.
 */
function sameColumn(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase()
}

/** An integer tenant column's id: digits only, as the database would store them. */
const CANONICAL_INTEGER = /^(0|-?[1-9][0-9]*)$/

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
    private readonly columns: Map<string, TenantColumn>,
    /** The same columns keyed by lower-cased table name, without a schema. */
    private readonly byBareName: Map<string, TenantColumn>,
    private readonly tenant: string | undefined,
    /** False for 'rls': the database filters; only inserts are filled. */
    private readonly filter = true,
  ) {
    super()
  }

  /**
   * A table's tenant column, however the query spells the table: `main.tasks`,
   * `public.tasks` and `TASKS` are all `tasks`, so a spelling can't step around
   * the filter. ponytail: a same-named untenanted table in another schema is
   * filtered too, and fails on the missing column rather than leaking.
   */
  private columnOf(table: string): TenantColumn | undefined {
    return (
      this.columns.get(table) ??
      this.byBareName.get(table.slice(table.lastIndexOf('.') + 1).toLowerCase())
    )
  }

  /** The tenant to filter by, or an error when a tenanted table is used without one. */
  private need(table: string, column: TenantColumn): string {
    if (this.tenant === undefined) throw new TenantRequiredError(table)
    // '01' or ' 1' would match tenant 1's rows once the database converts it.
    if (column.integer && !CANONICAL_INTEGER.test(this.tenant)) {
      throw new Error(
        `kickjs-db: tenant id '${this.tenant}' isn't an integer, and ${table}.${column.name} holds integers`,
      )
    }
    return this.tenant
  }

  /** Refuse a raw FROM item that hides a tenanted table the filter can't reach. */
  private refuseHidden(item: OperationNode): void {
    if (!this.filter) return
    for (const name of rawNames(item)) {
      if (this.columnOf(name)) {
        throw new Error(
          `kickjs-db: ${name} is tenanted, and inside raw SQL its tenant can't be added — use the table itself, or bypass()`,
        )
      }
    }
  }

  private withFilters(where: WhereNode | undefined, items: readonly OperationNode[]) {
    if (!this.filter) return where
    let out = where
    for (const item of items) {
      this.refuseHidden(item)
      const t = tableOf(item)
      const column = t && this.columnOf(t.table)
      if (!t || !column) continue
      const condition = matches(t.ref, column.name, this.need(t.table, column))
      out = out ? WhereNode.cloneWithOperation(out, 'And', condition) : WhereNode.create(condition)
    }
    return out
  }

  /**
   * A left join's tenant condition goes in its ON, so it stays a left join.
   * Any other join can keep the joined table's rows whatever its ON says (a
   * right or full join keeps them all), so there it goes in WHERE.
   */
  private withJoinFilters(
    joins: readonly JoinNode[] | undefined,
    where: WhereNode | undefined,
  ): { joins: readonly JoinNode[] | undefined; where: WhereNode | undefined } {
    if (!this.filter || !joins) return { joins, where }
    let w = where
    const out = joins.map((join) => {
      this.refuseHidden(join.table)
      const t = tableOf(join.table)
      const column = t && this.columnOf(t.table)
      if (!t || !column) return join
      const condition = matches(t.ref, column.name, this.need(t.table, column))
      if (join.joinType === 'LeftJoin' || join.joinType === 'LateralLeftJoin') {
        return JoinNode.cloneWithOn(join, condition)
      }
      w = w ? WhereNode.cloneWithOperation(w, 'And', condition) : WhereNode.create(condition)
      return join
    })
    return { joins: out, where: w }
  }

  /** A value written to a tenant column must be the current tenant. */
  private check(table: string, column: TenantColumn, value: unknown): void {
    const tenant = this.need(table, column)
    // The tenant id is a string; an integer / bigint tenant column's row holds a number.
    const id = typeof value === 'number' || typeof value === 'bigint' ? String(value) : value
    if (id !== tenant) {
      throw new Error(
        `kickjs-db: can't write ${table}.${column.name} = ${String(value)} as tenant ${tenant}`,
      )
    }
  }

  /**
   * SET on a tenant column: only to the current tenant, so an update can't
   * hand a row to another. An expression can't be checked: refused under
   * `'column'`; under `'rls'` the policy's check applies.
   */
  private checkUpdates(
    updates: readonly ColumnUpdateNode[] | undefined,
    targets: readonly OperationNode[],
  ): void {
    if (!updates) return
    for (const item of targets) {
      const t = tableOf(item)
      const column = t && this.columnOf(t.table)
      if (!t || !column) continue
      for (const u of updates) {
        const name = updatedColumn(u)
        // A SET whose column isn't a plain name can't be told apart from the tenant's.
        if (name === undefined && this.filter) {
          throw new Error(`kickjs-db: can't tell which column of tenanted ${t.table} a SET writes`)
        }
        if (!sameColumn(name, column.name)) continue
        if (ValueNode.is(u.value)) this.check(t.table, column, u.value.value)
        else if (this.filter) {
          throw new Error(
            `kickjs-db: can't set tenanted ${t.table}.${column.name} to an expression, which can't be checked`,
          )
        }
      }
    }
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    const out = super.transformSelectQuery(node)
    const filtered = this.withFilters(out.where, out.from?.froms ?? [])
    const { joins, where } = this.withJoinFilters(out.joins, filtered)
    return { ...out, ...(where ? { where } : {}), joins }
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    const out = super.transformUpdateQuery(node)
    const targets = itemsOf(out.table)
    this.checkUpdates(out.updates, [...targets, ...(out.joins ?? []).map((j) => j.table)])
    // The target(s) and every source table in UPDATE … FROM.
    const filtered = this.withFilters(out.where, [...targets, ...(out.from?.froms ?? [])])
    const { joins, where } = this.withJoinFilters(out.joins, filtered)
    return { ...out, ...(where ? { where } : {}), joins }
  }

  /** MERGE can't be limited to the tenant's rows on either side: refused. */
  protected override transformMergeQuery(node: MergeQueryNode): MergeQueryNode {
    const out = super.transformMergeQuery(node)
    if (!this.filter) return out
    for (const item of [out.into, ...(out.using ? [out.using.table] : [])]) {
      const t = tableOf(item)
      if (t && this.columnOf(t.table)) {
        throw new Error(`kickjs-db: MERGE can't be limited to tenanted ${t.table}'s rows`)
      }
      this.refuseHidden(item)
    }
    return out
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    const out = super.transformDeleteQuery(node)
    // The target and every source table in DELETE … USING.
    const filtered = this.withFilters(out.where, [...out.from.froms, ...(out.using?.tables ?? [])])
    const { joins, where } = this.withJoinFilters(out.joins, filtered)
    return { ...out, ...(where ? { where } : {}), joins }
  }

  /**
   * Fill the tenant column; refuse a row for another tenant. Under `'column'`
   * (`filter`), an insert whose tenant can't be checked is refused, and an
   * upsert's update is held to the tenant's rows. Under `'rls'` the policy
   * checks all of that itself.
   */
  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    let out = super.transformInsertQuery(node)
    const t = out.into ? tableOf(out.into) : undefined
    const tenantColumn = t && this.columnOf(t.table)
    if (!t || !tenantColumn) return out
    const column = tenantColumn.name
    const tenant = this.need(t.table, tenantColumn)
    const refuse = (why: string): never => {
      throw new Error(`kickjs-db: can't insert into tenanted ${t.table} — ${why}`)
    }
    const columns = out.columns
    const source = out.values
    if (!columns || !source || !ValuesNode.is(source)) {
      if (!this.filter) return out
      return refuse(
        'its tenant can only be checked on a values(...) insert, not INSERT … SELECT or DEFAULT VALUES',
      )
    }
    if (this.filter && (out.replace || out.orAction?.action.toLowerCase() === 'replace')) {
      refuse("REPLACE deletes whatever row it collides with, another tenant's included")
    }
    if (this.filter && out.onDuplicateKey) {
      refuse("MySQL's ON DUPLICATE KEY UPDATE can't be limited to the tenant's rows")
    }
    if (this.filter && out.onConflict?.updates) {
      // The conflicting row must be this tenant's too, or DO UPDATE would change another's.
      const condition = matches(t.ref, column, tenant)
      const updateWhere = out.onConflict.updateWhere
        ? WhereNode.cloneWithOperation(out.onConflict.updateWhere, 'And', condition)
        : WhereNode.create(condition)
      out = { ...out, onConflict: { ...out.onConflict, updateWhere } }
    }
    this.checkUpdates(out.onConflict?.updates, [out.into!])
    const at = columns.findIndex((c) => sameColumn(c.column.name, column))
    const check = (value: unknown) => this.check(t.table, tenantColumn, value)
    const rows = source.values.map((row) => {
      if (PrimitiveValueListNode.is(row)) {
        if (at === -1) return PrimitiveValueListNode.create([...row.values, tenant])
        check(row.values[at])
        return row
      }
      const values = row.values.map((v, i) => {
        if (i !== at) return v
        if (DefaultInsertValueNode.is(v)) return ValueNode.create(tenant)
        if (ValueNode.is(v)) check(v.value)
        else if (this.filter) refuse(`its ${column} is an expression, which can't be checked`)
        return v
      })
      return ValueListNode.create(at === -1 ? [...values, ValueNode.create(tenant)] : values)
    })
    return {
      ...out,
      columns: at === -1 ? [...columns, ColumnNode.create(column)] : columns,
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
    return {
      transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        const tenant = tenancy.current()
        if (tenant === null) return args.node
        if (tenant === undefined) throw new TenantRequiredError('(any table)')
        // Built per query, not cached by schema name: the tenant often comes
        // from a request, and a cache would grow with every name sent.
        return new WithSchemaPlugin(tenancy.schemaFor(tenant)).transformQuery(args)
      },
      async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        return args.result
      },
    }
  }
  const columns = collectTenantColumns(schema)
  const byBareName = new Map(
    [...columns].map(([table, c]) => [table.slice(table.lastIndexOf('.') + 1).toLowerCase(), c]),
  )
  return {
    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
      const tenant = tenancy.current()
      if (tenant === null) return args.node
      // Under 'rls' a missing tenant is the database's to refuse (the policy
      // matches nothing), so only inserts, which need a value, require one.
      return new TenantColumnFilter(
        columns,
        byBareName,
        tenant,
        tenancy.strategy === 'column',
      ).transformNode(args.node)
    },
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return args.result
    },
  }
}
