// ResultExtensionPlugin — Kysely plugin that powers `$extends({ result })`.
//
// Two halves:
//
//   1. transformQuery walks SelectQueryNode + identifies the table,
//      then injects ColumnNode references for every `needs` column
//      not already in the SELECT list. Selects already using `*`
//      (SelectAllNode) skip injection — the column is implicitly
//      there.
//
//   2. transformResult walks the rows after the driver returns them,
//      runs each compute(row) per matching table, and assigns the
//      result to row[<computedKey>]. Null/undefined rows pass through
//      untouched.
//
// The two halves share state via a per-queryId Map so transformResult
// only fires for queries this plugin marked in transformQuery — joins,
// sub-selects, multi-table FROMs, and other shapes we can't reliably
// attribute to a single table pass through both halves untouched.
// Aliased single-table selects (`.from('posts as p')`) ARE supported —
// the alias unwrap walks through to the underlying TableNode.

import {
  ColumnNode,
  IdentifierNode,
  AliasNode,
  ReferenceNode,
  SelectAllNode,
  SelectQueryNode,
  SelectionNode,
  TableNode,
  type KyselyPlugin,
  type OperationNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from 'kysely'

import type { ResolvedRelations } from '../query/relations'
import type { ResultExtension, ResultExtensions } from './types'

/** Database names ↔ schema keys, for a plugin that runs after renaming. */
export interface Naming {
  /** A table's schema key from its database name. */
  tableKey(dbName: string): string
  /** A column's database name from its table's key and its own key. */
  columnDb(tableKey: string, key: string): string
  /** The name a result row has to carry for the client to read it back as `key`. */
  resultName(key: string): string
}

const IDENTITY_NAMING: Naming = {
  tableKey: (t) => t,
  columnDb: (_t, k) => k,
  resultName: (k) => k,
}

/** Per-table computed-field bag. */
type TableExtensionBag = Record<string, ResultExtension<UnknownRow>>

export class ResultExtensionPlugin implements KyselyPlugin {
  private byTable: Map<string, TableExtensionBag>
  /**
   * queryId → table name the query targets. Populated in transformQuery,
   * consumed in transformResult. Weak: Kysely skips transformResult when the
   * query fails (bad input, a timeout, an abort), and a strong map kept one
   * entry for every such query a client could cause.
   */
  private pending = new WeakMap<QueryId, string>()

  /**
   * @param relations the client's relation graph. `db.query` returns related
   * rows nested under their relation names; with it, those rows get their
   * table's computeds too.
   */
  constructor(
    extensions: ResultExtensions<unknown>,
    private relations: ResolvedRelations = {},
    /**
     * The client's naming, under `casing` or `.colName()`: the plugin runs
     * after the query has been renamed, so it reads a table by its database
     * name and adds a needed column by its database name.
     */
    private naming: Naming = IDENTITY_NAMING,
  ) {
    this.byTable = new Map()
    for (const [tableName, bag] of Object.entries(extensions)) {
      if (!bag) continue
      const entries = Object.entries(bag) as Array<[string, ResultExtension<UnknownRow>]>
      if (entries.length === 0) continue
      this.byTable.set(tableName, Object.fromEntries(entries))
    }
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const { node, queryId } = args
    if (!SelectQueryNode.is(node)) return node
    const dbTable = singleTableTarget(node)
    if (!dbTable) return node
    const tableName = this.naming.tableKey(dbTable)
    const bag = this.byTable.get(tableName)
    // A table with no computeds of its own may still nest rows that have some.
    if (!bag && !this.reachesComputeds(tableName)) return node

    // Tag the query so transformResult knows to apply computeds.
    this.pending.set(queryId, tableName)

    // With a join, an unqualified needs column could name either table: not injected.
    return bag && !node.joins?.length
      ? injectNeeds(node, bag, (key) => ({
          column: this.naming.columnDb(tableName, key),
          as: this.naming.resultName(key),
        }))
      : node
  }

  /** Whether a table's related rows, at any depth, can have computeds. Cached per table. */
  private reach = new Map<string, boolean>()
  private reachesComputeds(table: string, seen = new Set<string>()): boolean {
    const known = this.reach.get(table)
    if (known !== undefined) return known
    seen.add(table)
    let found = false
    for (const rel of Object.values(this.relations[table] ?? {})) {
      const targets = rel.morphTo ? rel.morphTo.targets.map((t) => t.table) : [rel.target]
      if (
        targets.some((t) => this.byTable.has(t) || (!seen.has(t) && this.reachesComputeds(t, seen)))
      ) {
        found = true
        break
      }
    }
    // Only a finished answer is cached: one cut short by a cycle may be partial.
    if (found || seen.size === 1) this.reach.set(table, found)
    return found
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const tableName = this.pending.get(args.queryId)
    if (!tableName) return args.result
    this.pending.delete(args.queryId)

    const rows = args.result.rows.map((row) => this.computeRow(row, tableName, 0))
    return { ...args.result, rows }
  }

  /**
   * The row with its table's computeds, and — for related rows `db.query`
   * nested under a relation name — theirs, at every level.
   */
  private computeRow(row: UnknownRow, table: string, depth: number): UnknownRow {
    if (row === null || typeof row !== 'object' || depth > MAX_NESTING) return row
    const base = row as Record<string, unknown>
    let next: Record<string, unknown> | undefined
    const set = (key: string, value: unknown) => {
      next ??= { ...base }
      next[key] = value
    }

    const bag = this.byTable.get(table)
    for (const [key, ext] of Object.entries(bag ?? {})) {
      // A row holds only the columns selected for it (a nested row, or a join
      // where needs aren't injected); a computed whose columns aren't all
      // there is left off, not guessed.
      if (!Object.keys(ext.needs).every((c) => c in base)) continue
      // Pass `base` (the pristine row) into compute so computeds can't read
      // each other's outputs — order independence keeps the contract simple.
      let value: unknown
      try {
        value = ext.compute(base as UnknownRow)
      } catch {
        // A throwing compute shouldn't poison the row set: undefined.
        value = undefined
      }
      set(key, value)
    }

    for (const [key, rel] of Object.entries(this.relations[table] ?? {})) {
      const value = base[key]
      // A morphTo subject says which table it came from in `__type` (the
      // source's type column too, unless `columns` left it out).
      const tagged =
        (value as { __type?: unknown } | null)?.__type ?? base[rel.morphTo?.column ?? '']
      const target = rel.morphTo
        ? // The type value is a string in the snapshot; the column may hold a number.
          rel.morphTo.targets.find((t) => t.value === String(tagged))?.table
        : rel.target
      if (target === undefined) continue
      if (Array.isArray(value)) {
        set(
          key,
          value.map((v) => this.computeRow(v as UnknownRow, target, depth + 1)),
        )
      } else if (value && typeof value === 'object' && !(value instanceof Date)) {
        set(key, this.computeRow(value as UnknownRow, target, depth + 1))
      }
    }
    return (next ?? base) as UnknownRow
  }
}

/**
 * Detect the single table this select reads from. Returns the table
 * name when from has exactly one TableNode (or AliasNode wrapping
 * one); returns null for joins, sub-selects, multi-table selects,
 * and anything we can't reliably attribute. The plugin only acts on
 * single-table selects in v1.
 */
/** Relation nesting is bounded by `maxDepth` in the compiler; this only guards a cycle. */
const MAX_NESTING = 32

function singleTableTarget(node: SelectQueryNode): string | null {
  const from = node.from
  if (!from || from.froms.length !== 1) return null
  const target = unwrapAlias(from.froms[0])
  if (!TableNode.is(target)) return null
  const { schema, identifier } = target.table
  return schema ? `${schema.name}.${identifier.name}` : identifier.name
}

function unwrapAlias(node: OperationNode): OperationNode {
  // AliasNode wraps a child node in `.node`; we only care about the
  // underlying TableNode. Anything else passes through.
  if (node.kind === 'AliasNode') {
    const aliased = (node as unknown as { node: OperationNode }).node
    return aliased
  }
  return node
}

/**
 * Inject every needs column not already represented in the select
 * list. SelectAllNode (the `*` wildcard) means "all columns", in
 * which case there's nothing to add. Specific column references are
 * deduped by name so a column already selected explicitly stays put
 * exactly once.
 */
function injectNeeds(
  node: SelectQueryNode,
  bag: TableExtensionBag,
  dbName: (key: string) => { column: string; as: string },
): SelectQueryNode {
  const selections = node.selections ?? []
  // Wildcard select — every column is implicitly present.
  if (selections.some(isSelectAll)) return node

  const have = new Set<string>()
  for (const sel of selections) {
    const inner = sel.selection
    if (ReferenceNode.is(inner) && ColumnNode.is(inner.column)) {
      have.add(inner.column.column.name)
    } else if (ColumnNode.is(inner as OperationNode)) {
      have.add((inner as ColumnNode).column.name)
    }
  }

  const allNeeded = new Map<string, string>()
  for (const ext of Object.values(bag)) {
    for (const col of Object.keys(ext.needs)) {
      const { column, as } = dbName(col)
      allNeeded.set(column, as)
    }
  }

  const missing = [...allNeeded].filter(([c]) => !have.has(c))
  if (missing.length === 0) return node

  // Named the way the client's result renaming expects (a `.colName()`
  // column comes back under its key), since that renaming has already been
  // set up for the rest of the query.
  const additions: SelectionNode[] = missing.map(([col, as]) => {
    const ref = ReferenceNode.create(ColumnNode.create(col))
    return SelectionNode.create(as === col ? ref : AliasNode.create(ref, IdentifierNode.create(as)))
  })
  return SelectQueryNode.cloneWithSelections(node, additions)
}

function isSelectAll(node: SelectionNode): boolean {
  const inner = node.selection
  if (SelectAllNode.is(inner)) return true
  if (ReferenceNode.is(inner) && SelectAllNode.is(inner.column)) return true
  return false
}
