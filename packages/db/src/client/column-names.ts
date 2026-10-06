/**
 * `.dbName()` at runtime: a column whose database name isn't its key. Unlike
 * `casing`, which converts every name the same way, the mapping depends on
 * the table — `email` may be `EMAIL_ADDR` in `users` and `email` in `posts` —
 * so each column reference is resolved against the tables in scope.
 *
 * A renamed column that's selected is aliased back to its key
 * (`"EMAIL_ADDR" as "email"`); `select *` rows are renamed back afterwards.
 */
import {
  AliasNode,
  ColumnNode,
  IdentifierNode,
  OperationNodeTransformer,
  ReferenceNode,
  SelectionNode,
  TableNode,
  type DeleteQueryNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type SelectQueryNode,
  type UnknownRow,
  type UpdateQueryNode,
} from 'kysely'

/** Table name (as queries name it) → column name (as queries name it) → the database's name. */
export type ColumnNameMap = ReadonlyMap<string, ReadonlyMap<string, string>>

/** In scope: what a query calls a table (its alias or name) → the table. */
type Scope = Map<string, string>

function tableName(node: TableNode): string {
  const { schema, identifier } = node.table
  return schema ? `${schema.name}.${identifier.name}` : identifier.name
}

/** A FROM / JOIN / INTO item, as `[what the query calls it, the table]`. */
function scopeEntry(node: OperationNode | undefined): [string, string] | undefined {
  if (!node) return undefined
  if (TableNode.is(node)) return [tableName(node), tableName(node)]
  if (AliasNode.is(node) && TableNode.is(node.node) && IdentifierNode.is(node.alias)) {
    return [node.alias.name, tableName(node.node)]
  }
  return undefined
}

class Renamer extends OperationNodeTransformer {
  private readonly scopes: Scope[] = []
  /** Tables at the top of the query — whose `*` rows come back to rename. */
  readonly outer = new Set<string>()

  constructor(private readonly names: ColumnNameMap) {
    super()
  }

  private withScope<T>(items: readonly (OperationNode | undefined)[], run: () => T): T {
    const scope: Scope = new Map()
    for (const item of items) {
      const entry = scopeEntry(item)
      if (entry) scope.set(entry[0], entry[1])
    }
    if (this.scopes.length === 0) for (const table of scope.values()) this.outer.add(table)
    this.scopes.push(scope)
    try {
      return run()
    } finally {
      this.scopes.pop()
    }
  }

  /** The database's name for `column`, qualified by `ref` or found in the innermost scope. */
  private resolve(column: string, ref?: string): string | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!
      if (ref !== undefined) {
        const table = scope.get(ref)
        if (table !== undefined) return this.names.get(table)?.get(column)
        continue
      }
      // Unqualified: the one table in this scope that renames it, if only one does.
      const found = [...new Set(scope.values())]
        .map((t) => this.names.get(t)?.get(column))
        .filter((n) => n !== undefined)
      if (found.length === 1) return found[0]
      if (scope.size > 0) return undefined
    }
    return ref === undefined ? undefined : this.names.get(ref)?.get(column)
  }

  protected override transformSelectQuery(node: SelectQueryNode): SelectQueryNode {
    return this.withScope(
      [...(node.from?.froms ?? []), ...(node.joins ?? []).map((j) => j.table)],
      () => super.transformSelectQuery(node),
    )
  }

  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    // `excluded` (ON CONFLICT … DO UPDATE) is the row being inserted, so the target's columns.
    const target = scopeEntry(node.into)
    return this.withScope(
      [
        node.into,
        ...(target ? [AliasNode.create(node.into!, IdentifierNode.create('excluded'))] : []),
      ],
      () => super.transformInsertQuery(node),
    )
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    return this.withScope(
      [node.table, ...(node.from?.froms ?? []), ...(node.joins ?? []).map((j) => j.table)],
      () => super.transformUpdateQuery(node),
    )
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    return this.withScope(
      [
        ...node.from.froms,
        ...(node.using?.tables ?? []),
        ...(node.joins ?? []).map((j) => j.table),
      ],
      () => super.transformDeleteQuery(node),
    )
  }

  protected override transformReference(node: ReferenceNode): ReferenceNode {
    if (!ColumnNode.is(node.column)) return super.transformReference(node)
    const dbName = this.resolve(node.column.column.name, node.table && tableName(node.table))
    // Not renamed: left as it is — not looked up again unqualified, where
    // another table in scope could claim the name.
    if (dbName === undefined) return node
    return node.table
      ? ReferenceNode.create(ColumnNode.create(dbName), node.table)
      : ReferenceNode.create(ColumnNode.create(dbName))
  }

  /** A bare column: an INSERT's column list, an UPDATE's SET, ON CONFLICT's target. */
  protected override transformColumn(node: ColumnNode): ColumnNode {
    const dbName = this.resolve(node.column.name)
    return dbName === undefined ? node : ColumnNode.create(dbName)
  }

  /** A renamed column that's selected keeps its key: `"EMAIL_ADDR" as "email"`. */
  protected override transformSelection(node: SelectionNode): SelectionNode {
    const out = super.transformSelection(node)
    const before = columnName(node.selection)
    const after = columnName(out.selection)
    return before !== undefined && after !== undefined && before !== after
      ? SelectionNode.create(AliasNode.create(out.selection, IdentifierNode.create(before)))
      : out
  }
}

function columnName(node: OperationNode): string | undefined {
  if (ColumnNode.is(node)) return node.column.name
  if (ReferenceNode.is(node) && ColumnNode.is(node.column)) return node.column.column.name
  return undefined
}

/**
 * The plugin, in two halves like `casing`'s: queries are rewritten `last`,
 * after everything else has written them by key (and after `casing`); `select
 * *` rows are renamed back `first`, before anything — codecs, `casing` —
 * reads them by name.
 */
export function columnNamePlugins(names: ColumnNameMap): {
  first: KyselyPlugin
  last: KyselyPlugin
} {
  // Per query: a `select *` row's database names, back to the query's names.
  const pending = new WeakMap<QueryId, Map<string, string>>()
  return {
    first: {
      transformQuery: (args: PluginTransformQueryArgs): RootOperationNode => args.node,
      async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        const back = pending.get(args.queryId)
        if (!back || !args.result.rows) return args.result
        return {
          ...args.result,
          rows: args.result.rows.map((row) => {
            const out: UnknownRow = {}
            for (const [k, v] of Object.entries(row)) out[back.get(k) ?? k] = v
            return out
          }),
        }
      },
    },
    last: {
      transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        const renamer = new Renamer(names)
        const node = renamer.transformNode(args.node)
        const back = new Map<string, string>()
        for (const table of renamer.outer) {
          for (const [column, dbName] of names.get(table) ?? []) back.set(dbName, column)
        }
        if (back.size > 0) pending.set(args.queryId, back)
        return node
      },
      transformResult: async (args: PluginTransformResultArgs) => args.result,
    },
  }
}
