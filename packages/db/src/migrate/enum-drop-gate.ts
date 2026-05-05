/**
 * Runner gate for the `-- KICK ENUM REMOVE` header.
 *
 * Pure parser + decision function — no I/O, no adapter, no DB. The
 * runner reads up.sql, hands it to `parseEnumDropHeader`, and
 * passes the result to `enforceEnumDropGate` which throws
 * `MigrationEnumDropError` when the header is present and
 * `confirmEnumDrop` is falsy.
 *
 * Spec: docs/db/spec-enum-value-removal.md §4.
 */

import { ENUM_DROP_HEADER } from '../emit/pg'
import { MigrationEnumDropError } from './errors'

/**
 * Parsed payload from the header block. Empty arrays for keys not
 * present (resilient to operators editing the migration by hand).
 */
export interface EnumDropHeader {
  enums: string[]
  removed: string[]
  columns: string[]
}

/**
 * Scan the first 64 lines of an up.sql for one or more enum-drop
 * header blocks. Returns null when no header is present.
 */
export function parseEnumDropHeader(sql: string): EnumDropHeader | null {
  if (!sql.includes(ENUM_DROP_HEADER)) return null

  const lines = sql.split(/\r?\n/, 64)
  const enums: string[] = []
  const removed: string[] = []
  const columns: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? ''
    if (line !== ENUM_DROP_HEADER) continue
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]?.trim() ?? ''
      if (!next.startsWith('--')) break
      const m = /^--\s*([a-z]+):\s*(.+)$/i.exec(next)
      if (!m) continue
      const key = m[1]!.toLowerCase()
      const raw = m[2]!.trim()
      if (key === 'enum') enums.push(raw)
      else if (key === 'removed') removed.push(...splitListing(raw))
      else if (key === 'columns') columns.push(...splitListing(raw))
    }
  }

  if (enums.length === 0 && removed.length === 0 && columns.length === 0) {
    return { enums: [], removed: [], columns: [] }
  }
  return { enums, removed, columns }
}

/**
 * Throws `MigrationEnumDropError` when the migration has an
 * enum-drop header and `confirmEnumDrop` is not set. Returns
 * silently otherwise.
 */
export function enforceEnumDropGate(
  id: string,
  sql: string,
  confirmEnumDrop: boolean,
): EnumDropHeader | null {
  const header = parseEnumDropHeader(sql)
  if (!header) return null
  if (!confirmEnumDrop) {
    throw new MigrationEnumDropError(id, header.enums, header.removed, header.columns)
  }
  return header
}

function splitListing(raw: string): string[] {
  if (raw === '(none)' || raw === '') return []
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter((s) => s.length > 0)
}
