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

/** Per-table computed-field bag. */
type TableExtensionBag = Record<string, ResultExtension<UnknownRow>>

export class ResultExtensionPlugin implements KyselyPlugin {
  private byTable: Map<string, TableExtensionBag>
  /**
   * Map of queryId → table name the query targets. Populated in
   * transformQuery, consumed in transformResult, deleted after use so
   * it doesn't leak across long-lived clients.
   */
  private pending = new Map<QueryId, string>()

  /**
   * @param relations the client's relation graph. `db.query` returns related
   * rows nested under their relation names; with it, those rows get their
   * table's computeds too.
   */
  constructor(
    extensions: ResultExtensions<unknown>,
    private relations: ResolvedRelations = {},
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
    const tableName = singleTableTarget(node)
    if (!tableName) return node
    const bag = this.byTable.get(tableName)
    if (!bag) return node

    // Tag the query so transformResult knows to apply computeds.
    this.pending.set(queryId, tableName)

    return injectNeeds(node, bag)
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
      // A nested row holds only the columns `db.query` selected for it; a
      // computed whose columns aren't all there is left off, not guessed.
      if (depth > 0 && !Object.keys(ext.needs).every((c) => c in base)) continue
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
      if (Array.isArray(value)) {
        set(
          key,
          value.map((v) => this.computeRow(v as UnknownRow, rel.target, depth + 1)),
        )
      } else if (value && typeof value === 'object' && !(value instanceof Date)) {
        set(key, this.computeRow(value as UnknownRow, rel.target, depth + 1))
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
  return target.table.identifier.name
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
function injectNeeds(node: SelectQueryNode, bag: TableExtensionBag): SelectQueryNode {
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

  const allNeeded = new Set<string>()
  for (const ext of Object.values(bag)) {
    for (const col of Object.keys(ext.needs)) {
      allNeeded.add(col)
    }
  }

  const missing = [...allNeeded].filter((c) => !have.has(c))
  if (missing.length === 0) return node

  const additions: SelectionNode[] = missing.map((col) =>
    SelectionNode.create(ReferenceNode.create(ColumnNode.create(col))),
  )
  return SelectQueryNode.cloneWithSelections(node, additions)
}

function isSelectAll(node: SelectionNode): boolean {
  const inner = node.selection
  if (SelectAllNode.is(inner)) return true
  if (ReferenceNode.is(inner) && SelectAllNode.is(inner.column)) return true
  return false
}
