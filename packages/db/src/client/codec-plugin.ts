// Codec plugin — applies CustomColumnBuilder.fromDriver to selected
// rows so adopters who declared `customType<T>({ fromDriver })` get
// decoded values automatically (decrypted strings, parsed structured
// data, etc.) without writing their own per-call mapper.
//
// Scope: this plugin transforms RESULT rows only. The matching
// toDriver pass for INSERT / UPDATE values requires walking Kysely's
// OperationNode tree (InsertQueryNode + UpdateQueryNode + their
// nested ColumnUpdateNodes), which is bigger work and lands as a
// follow-up. Adopters with toDriver wired today should call it
// manually before passing the value to `.values()` / `.set()`.
//
// Decoder lookup is by COLUMN NAME — not table.column — so two tables
// declaring a column with the same name share the codec. That's a
// known limitation; the row-shape doesn't always carry table
// provenance once joins land.

import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely'

import { CustomColumnBuilder } from '../custom-type'
import type { ColumnBuilder } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/** Map of column name → decoder. Built once at createDbClient time. */
export type DecoderMap = Map<string, (driver: unknown) => unknown>

export class CodecResultPlugin implements KyselyPlugin {
  constructor(private decoders: DecoderMap) {}

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    if (this.decoders.size === 0) return args.result
    const rows = args.result.rows.map((row) => this.decodeRow(row))
    return { ...args.result, rows }
  }

  private decodeRow(row: UnknownRow): UnknownRow {
    let mutated = false
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(row)) {
      const value = (row as Record<string, unknown>)[key]
      const decoder = this.decoders.get(key)
      // Skip null/undefined — the codec wasn't set up to decode
      // missing values; passing them through preserves nullable
      // column semantics without forcing every codec to handle null.
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
 *
 * Schema entries that aren't table declarations (e.g. `relations()`
 * registrations) are skipped. Columns without a fromDriver are
 * skipped — registering an entry without one would still cost a
 * Map lookup per row for no payoff.
 */
export function buildDecoderMap(schema: unknown): DecoderMap {
  const decoders: DecoderMap = new Map()
  if (!schema || typeof schema !== 'object') return decoders

  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!isTableDecl(value)) continue
    for (const [colName, col] of Object.entries(value.__columns)) {
      if (col instanceof CustomColumnBuilder && col.fromDriver) {
        decoders.set(colName, col.fromDriver)
      }
    }
  }
  return decoders
}

function isTableDecl(value: unknown): value is TableDecl<string, Record<string, ColumnBuilder>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __isTable?: boolean }).__isTable === true
  )
}
