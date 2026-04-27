import { diff } from '../diff/engine'
import type { Change } from '../diff/types'
import type { SchemaSnapshot } from '../snapshot/types'
import { MigrationDriftError, type SchemaDiffSummary } from './errors'

export type DriftBehavior = 'error' | 'warn' | 'ignore'

export interface DriftLogger {
  warn: (message: string) => void
}

export async function checkDrift(
  liveSnapshot: SchemaSnapshot,
  expectedSnapshot: SchemaSnapshot,
  behavior: DriftBehavior,
  log: DriftLogger = console,
): Promise<void> {
  if (behavior === 'ignore') return
  // diff(prev, next) reads expected as `prev` and live as `next` so 'added'
  // means "live has it but the snapshot doesn't" — i.e. someone ran DDL
  // outside the migration runner.
  const changes = diff(expectedSnapshot, liveSnapshot)
  if (changes.length === 0) return

  const summary = summarize(changes)
  const message = `Schema drift detected: ${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed`
  if (behavior === 'warn') {
    log.warn(message)
    return
  }
  throw new MigrationDriftError(message, summary)
}

function summarize(changes: Change[]): SchemaDiffSummary {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const c of changes) {
    switch (c.kind) {
      case 'createTable':
        added.push(c.table.name)
        break
      case 'dropTable':
        removed.push(c.table.name)
        break
      case 'addColumn':
        added.push(`${c.table}.${c.column.name}`)
        break
      case 'dropColumn':
        removed.push(`${c.table}.${c.column.name}`)
        break
      case 'alterColumn':
        changed.push(`${c.table}.${c.column}`)
        break
      case 'renameColumn':
        changed.push(`${c.table}.${c.from}→${c.to}`)
        break
      case 'renameTable':
        changed.push(`${c.from}→${c.to}`)
        break
      case 'addIndex':
        added.push(`${c.table}#${c.index.name}`)
        break
      case 'dropIndex':
        removed.push(`${c.table}#${c.index.name}`)
        break
      case 'addForeignKey':
        added.push(`${c.table}!${c.fk.name}`)
        break
      case 'dropForeignKey':
        removed.push(`${c.table}!${c.fk.name}`)
        break
    }
  }
  return { added, removed, changed }
}
