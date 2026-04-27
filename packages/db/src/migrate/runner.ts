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

async function listPending(opts: RunnerOptions): Promise<PreparedEntry[]> {
  const journal = await readJournal(opts.migrationsDir, opts.adapter.dialect)
  const applied = await opts.adapter.listApplied()
  const appliedIds = new Set(applied.map((r) => r.id))
  return journal.entries
    .filter((e) => !appliedIds.has(e.id))
    .map((e) => ({ id: e.id, tag: e.tag, hash: e.hash }))
}

export async function migrateLatest(opts: RunnerOptions): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const pending = await listPending(opts)
    return runForward(opts, pending)
  })
}

export async function migrateUp(opts: RunnerOptions): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const pending = await listPending(opts)
    return runForward(opts, pending.slice(0, 1))
  })
}

export interface ReversedSummary {
  reversed: string | null
}

async function applyReverse(id: string, opts: RunnerOptions): Promise<void> {
  const dir = path.join(opts.migrationsDir, id)
  const downSql = await readFile(path.join(dir, 'down.sql'), 'utf8')
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
  const requireReviewed = opts.requireReviewed ?? process.env.NODE_ENV !== 'development'
  if (requireReviewed && meta.reviewed !== true) {
    throw new UnreviewedMigrationError(id)
  }
  const useTx = meta.transaction !== false
  if (useTx) {
    await opts.adapter.applySqlInTx(downSql)
  } else {
    await opts.adapter.applySqlNoTx(downSql)
  }
  await opts.adapter.removeApplied(id)
}

export async function migrateDown(opts: RunnerOptions): Promise<ReversedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: null }
    // Sort by batch then appliedAt so 'most recent' is unambiguous even if
    // two migrations share a batch number (same `migrate latest` run).
    const sorted = [...applied].sort((a, b) =>
      a.batch !== b.batch ? a.batch - b.batch : a.appliedAt.localeCompare(b.appliedAt),
    )
    const last = sorted[sorted.length - 1]
    await applyReverse(last.id, opts)
    return { reversed: last.id }
  })
}

export interface RollbackSummary {
  reversed: string[]
  batch: number | null
}

export interface StatusEntry {
  id: string
  tag: string
  hash: string
  state: 'applied' | 'pending'
  batch: number | null
  appliedAt: string | null
  reviewed: boolean
}

export async function migrateStatus(
  opts: Pick<RunnerOptions, 'adapter' | 'migrationsDir'>,
): Promise<StatusEntry[]> {
  await opts.adapter.ensureMigrationTables()
  const journal = await readJournal(opts.migrationsDir, opts.adapter.dialect)
  const applied = await opts.adapter.listApplied()
  const byId = new Map(applied.map((r) => [r.id, r]))

  const entries: StatusEntry[] = []
  for (const e of journal.entries) {
    const row = byId.get(e.id)
    let reviewed = false
    try {
      const meta = JSON.parse(
        await readFile(path.join(opts.migrationsDir, e.id, 'meta.json'), 'utf8'),
      )
      reviewed = meta.reviewed === true
    } catch {
      // Missing meta.json — treat as un-reviewed; the runner will refuse to
      // apply anyway. Don't fail status output for diagnostic purposes.
    }
    entries.push({
      id: e.id,
      tag: e.tag,
      hash: e.hash,
      state: row ? 'applied' : 'pending',
      batch: row?.batch ?? null,
      appliedAt: row?.appliedAt ?? null,
      reviewed,
    })
  }
  return entries
}

export async function migrateRollback(opts: RunnerOptions): Promise<RollbackSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: [], batch: null }

    const lastBatch = Math.max(...applied.map((r) => r.batch))
    // Reverse-applied order so teardown matches dependencies (drop FK before
    // drop table etc).
    const targets = applied
      .filter((r) => r.batch === lastBatch)
      .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
      .reverse()

    const reversed: string[] = []
    for (const row of targets) {
      await applyReverse(row.id, opts)
      reversed.push(row.id)
    }
    return { reversed, batch: lastBatch }
  })
}
