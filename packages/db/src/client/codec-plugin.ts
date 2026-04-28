// Codec plugin — wires CustomColumnBuilder codecs into Kysely.
//
// Two transforms in one plugin:
//
// - `transformQuery` walks the AST for INSERT and UPDATE statements
//   and applies `toDriver(value)` to every ValueNode whose surrounding
//   ColumnNode matches a column in the encoder map. Pass-through for
//   `insert ... select`, `defaultValues`, references, and other
//   non-literal value expressions.
//
// - `transformResult` walks selected rows and applies `fromDriver` per
//   matching column name. Null/undefined pass through so codecs don't
//   need a nullable branch.
//
// Both maps are keyed by COLUMN NAME (not table.column). Two tables
// declaring the same name share a codec — the row shape returned from
// joins doesn't always carry table provenance, so any table-aware
// scheme would degrade silently. Adopters using clashing column names
// across tables with different codecs should declare distinct
// `customType` instances or rename the column.

import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely'
import {
  ColumnNode,
  ColumnUpdateNode,
  InsertQueryNode,
  PrimitiveValueListNode,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
  type OperationNode,
  type ValuesItemNode,
} from 'kysely'

import { CustomColumnBuilder } from '../custom-type'
import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/** Map of column name → encoder/decoder. Built once at createDbClient time. */
export type CodecMap = Map<string, (value: unknown) => unknown>

export class CodecPlugin implements KyselyPlugin {
  constructor(
    private encoders: CodecMap,
    private decoders: CodecMap,
  ) {}

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (this.encoders.size === 0) return args.node
    const node = args.node
    if (InsertQueryNode.is(node)) return this.transformInsert(node)
    if (UpdateQueryNode.is(node)) return this.transformUpdate(node)
    return node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    if (this.decoders.size === 0) return args.result
    const rows = args.result.rows.map((row) => this.decodeRow(row))
    return { ...args.result, rows }
  }

  // ---------------------------- query side ----------------------------

  private transformInsert(node: InsertQueryNode): InsertQueryNode {
    const cols = node.columns
    const values = node.values
    if (!cols || !values) return node
    // Build per-position encoder lookup once. Positions without a
    // matching encoder stay null so the inner loop can early-skip
    // without re-hashing on every row.
    const positional = this.positionalEncoders(cols)
    if (!positional) return node

    if (ValuesNode.is(values)) {
      const items = values.values.map((item) => this.encodeValuesItem(item, positional))
      // Reference equality preserved when no item changed.
      const changed = items.some((item, i) => item !== values.values[i])
      if (!changed) return node
      // ValuesItemNode is the public union ValueListNode | PrimitiveValueListNode;
      // every encodeValuesItem path either returns the original item (already a
      // ValuesItemNode) or rebuilds via the matching factory, so the cast holds.
      return InsertQueryNode.cloneWith(node, {
        values: ValuesNode.create(items as unknown as ReadonlyArray<ValuesItemNode>),
      })
    }

    // SelectQueryNode (insert from select), DefaultInsertValueNode, and
    // any future shape: pass through. We can't safely transform values
    // we didn't read literally.
    return node
  }

  private transformUpdate(node: UpdateQueryNode): UpdateQueryNode {
    const updates = node.updates
    if (!updates || updates.length === 0) return node

    let changed = false
    const next = updates.map((u) => {
      const col = u.column
      if (!ColumnNode.is(col)) return u
      const encoder = this.encoders.get(col.column.name)
      if (!encoder) return u
      const encoded = this.encodeValueNode(u.value, encoder)
      if (encoded === u.value) return u
      changed = true
      return ColumnUpdateNode.create(col, encoded)
    })
    if (!changed) return node
    // Kysely's UpdateQueryNode.cloneWithUpdates APPENDS to existing
    // updates rather than replacing them — wrong semantics for our
    // mutate-in-place flow. Spread directly. `node` is already
    // narrowed to UpdateQueryNode so the override typechecks cleanly.
    return { ...node, updates: next }
  }

  private positionalEncoders(
    cols: ReadonlyArray<ColumnNode>,
  ): Array<((v: unknown) => unknown) | null> | null {
    const out: Array<((v: unknown) => unknown) | null> = new Array(cols.length)
    let any = false
    for (let i = 0; i < cols.length; i++) {
      const enc = this.encoders.get(cols[i].column.name) ?? null
      out[i] = enc
      if (enc) any = true
    }
    return any ? out : null
  }

  private encodeValuesItem(
    item: OperationNode,
    positional: Array<((v: unknown) => unknown) | null>,
  ): OperationNode {
    if (ValueListNode.is(item)) {
      const next = item.values.map((v, i) => {
        const enc = positional[i]
        if (!enc) return v
        return this.encodeValueNode(v, enc)
      })
      const changed = next.some((v, i) => v !== item.values[i])
      return changed ? ValueListNode.create(next) : item
    }
    if (PrimitiveValueListNode.is(item)) {
      const next = item.values.map((v, i) => {
        const enc = positional[i]
        if (!enc) return v
        return this.encodePrimitive(v, enc)
      })
      const changed = next.some((v, i) => v !== item.values[i])
      return changed ? PrimitiveValueListNode.create(next) : item
    }
    return item
  }

  private encodeValueNode(node: OperationNode, encoder: (v: unknown) => unknown): OperationNode {
    if (!ValueNode.is(node)) return node
    const value = node.value
    if (value === null || value === undefined) return node
    const encoded = encoder(value)
    if (encoded === value) return node
    return ValueNode.create(encoded)
  }

  private encodePrimitive(value: unknown, encoder: (v: unknown) => unknown): unknown {
    if (value === null || value === undefined) return value
    return encoder(value)
  }

  // ---------------------------- result side ----------------------------

  private decodeRow(row: UnknownRow): UnknownRow {
    let mutated = false
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(row)) {
      const value = (row as Record<string, unknown>)[key]
      const decoder = this.decoders.get(key)
      if (decoder && value !== null && value !== undefined) {
        out[key] = decoder(value)
        mutated = true
      } else {
        out[key] = value
      }
    }
    return (mutated ? out : row) as UnknownRow
  }
}

/**
 * Walk a schema record and collect decoders from every column whose
 * builder is a `CustomColumnBuilder` with a `fromDriver` codec set.
 */
export function buildDecoderMap(schema: unknown): CodecMap {
  return collectCodecs(schema, 'fromDriver')
}

/**
 * Walk a schema record and collect encoders from every column whose
 * builder is a `CustomColumnBuilder` with a `toDriver` codec set.
 */
export function buildEncoderMap(schema: unknown): CodecMap {
  return collectCodecs(schema, 'toDriver')
}

function collectCodecs(schema: unknown, key: 'toDriver' | 'fromDriver'): CodecMap {
  const out: CodecMap = new Map()
  if (!schema || typeof schema !== 'object') return out

  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!isTableDecl(value)) continue
    for (const [colName, col] of Object.entries(value.__columns)) {
      if (col instanceof CustomColumnBuilder) {
        const fn = col[key]
        if (fn) out.set(colName, fn as (v: unknown) => unknown)
      }
    }
  }
  return out
}

function isTableDecl(value: unknown): value is TableDecl<string, Record<string, ColumnBuilder>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __isTable?: boolean }).__isTable === true
  )
}
