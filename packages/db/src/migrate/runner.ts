import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { readJournal, computeMigrationHash } from './journal'
import { MigrationLockError, MigrationHashError, UnreviewedMigrationError } from './errors'
import type { MigrationAdapter } from './adapter'

export interface RunnerOptions {
  adapter: MigrationAdapter
  migrationsDir: string
  /** When true, refuse to apply migrations whose meta.json.reviewed is false. Defaults to true outside dev. */
  requireReviewed?: boolean
  /** Owner string written into the lock table for diagnostics. */
  owner?: string
}

export interface AppliedSummary {
  applied: string[]
  batch: number | null
}

interface PreparedEntry {
  id: string
  tag: string
  hash: string
}

async function withLock<T>(opts: RunnerOptions, fn: () => Promise<T>): Promise<T> {
  const owner = opts.owner ?? `${process.pid}@${new Date().toISOString()}`
  const got = await opts.adapter.acquireLock(owner)
  if (!got) {
    throw new MigrationLockError('Another process holds the migration lock')
  }
  try {
    return await fn()
  } finally {
    await opts.adapter.releaseLock()
  }
}

/**
 * Verify pending entries: hash matches stored, meta.reviewed is true (if
 * requireReviewed). Throws MigrationHashError or UnreviewedMigrationError on
 * the first failure.
 */
async function verifyPending(
  pending: PreparedEntry[],
  migrationsDir: string,
  requireReviewed: boolean,
): Promise<void> {
  for (const entry of pending) {
    const dir = path.join(migrationsDir, entry.id)
    const actualHash = await computeMigrationHash(dir)
    if (actualHash !== entry.hash) {
      throw new MigrationHashError(entry.id, entry.hash, actualHash)
    }
    if (requireReviewed) {
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
      if (meta.reviewed !== true) {
        throw new UnreviewedMigrationError(entry.id)
      }
    }
  }
}

async function applyEntry(entry: PreparedEntry, batch: number, opts: RunnerOptions): Promise<void> {
  const dir = path.join(opts.migrationsDir, entry.id)
  const upSql = await readFile(path.join(dir, 'up.sql'), 'utf8')
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
  const useTx = meta.transaction !== false

  if (useTx) {
    await opts.adapter.applySqlInTx(upSql)
  } else {
    await opts.adapter.applySqlNoTx(upSql)
  }
  await opts.adapter.recordApplied({
    id: entry.id,
    name: entry.tag,
    hash: entry.hash,
    batch,
    direction: 'up',
  })
}

async function runForward(opts: RunnerOptions, pending: PreparedEntry[]): Promise<AppliedSummary> {
  if (pending.length === 0) {
    return { applied: [], batch: null }
  }

  const requireReviewed = opts.requireReviewed ?? process.env.NODE_ENV !== 'development'
  await verifyPending(pending, opts.migrationsDir, requireReviewed)

  const applied = await opts.adapter.listApplied()
  const nextBatch = (applied.length === 0 ? 0 : Math.max(...applied.map((r) => r.batch))) + 1

  const ids: string[] = []
  for (const entry of pending) {
    await applyEntry(entry, nextBatch, opts)
    ids.push(entry.id)
  }
  return { applied: ids, batch: nextBatch }
}

export async function migrateLatest(opts: RunnerOptions): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()

  return withLock(opts, async () => {
    const journal = await readJournal(opts.migrationsDir, opts.adapter.dialect)
    const applied = await opts.adapter.listApplied()
    const appliedIds = new Set(applied.map((r) => r.id))
    const pending = journal.entries
      .filter((e) => !appliedIds.has(e.id))
      .map((e) => ({ id: e.id, tag: e.tag, hash: e.hash }))
    return runForward(opts, pending)
  })
}
