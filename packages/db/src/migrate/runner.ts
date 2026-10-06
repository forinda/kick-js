import { parseJournal, hashMigration, type JournalEntry } from './journal'
import {
  MigrationFailedError,
  MigrationLockError,
  MigrationHashError,
  UnreviewedMigrationError,
} from './errors'
import { checkDrift, type DriftBehavior, type DriftLogger } from './drift'
import { enforceEnumDropGate } from './enum-drop-gate'
import { runCodeMigration } from './code-migration'
import { migrationFolders, type MigrationFolder, type MigrationsLocation } from './source'
import type { MigrationAdapter } from './adapter'
import type { SchemaSnapshot } from '../snapshot/types'

export interface RunnerOptions {
  adapter: MigrationAdapter
  /**
   * The migrations folder — or several, run as one history ordered by
   * migration id. Each keeps its own journal and snapshots. Bundled files
   * (`migrationFiles()`) work in place of a folder.
   */
  migrationsDir: MigrationsLocation
  /** When true, refuse to apply migrations whose meta.json.reviewed is false. Defaults to true outside dev. */
  requireReviewed?: boolean
  /** Owner string written into the lock table for diagnostics. */
  owner?: string
  /** Drift detection mode. Default 'error'. */
  driftCheck?: DriftBehavior
  /** Logger surface for drift warnings. Defaults to console. */
  log?: DriftLogger
  /**
   * Allow migrations carrying the `-- KICK ENUM REMOVE` header to
   * apply. Default `false`. CLI exposes via `--confirm-enum-drop`.
   */
  confirmEnumDrop?: boolean
}

export interface AppliedSummary {
  applied: string[]
  batch: number | null
}

interface PreparedEntry {
  id: string
  tag: string
  hash: string
  /** The folder it lives in. */
  folder: MigrationFolder
}

interface LocatedEntry extends JournalEntry {
  folder: MigrationFolder
}

/** A migration's file — an error when it's missing. */
async function readRequired(folder: MigrationFolder, id: string, file: string): Promise<string> {
  const text = await folder.read(`${id}/${file}`)
  if (text === undefined)
    throw new Error(`kickjs-db: migration ${id} has no ${file} in ${folder.name}`)
  return text
}

async function readMeta(folder: MigrationFolder, id: string) {
  return JSON.parse(await readRequired(folder, id, 'meta.json')) as {
    reviewed?: boolean
    transaction?: boolean
  }
}

/** The hash of the migration as it is now. */
async function currentHash(folder: MigrationFolder, id: string): Promise<string> {
  return hashMigration(
    await readRequired(folder, id, 'up.sql'),
    await readRequired(folder, id, 'down.sql'),
    await readRequired(folder, id, 'snapshot.json'),
    (await folder.code(id))?.text,
  )
}

/**
 * Every journal entry across the migration folders, each with its folder.
 * One folder keeps its journal's order; several are merged by migration id,
 * which starts with its creation time.
 */
async function readJournals(
  migrationsDir: RunnerOptions['migrationsDir'],
  dialect: SchemaSnapshot['dialect'],
): Promise<LocatedEntry[]> {
  const folders = migrationFolders(migrationsDir)
  const seen = new Map<string, string>()
  const entries: LocatedEntry[] = []
  for (const folder of folders) {
    for (const e of parseJournal(await folder.read('_journal.json'), dialect).entries) {
      const other = seen.get(e.id)
      if (other) {
        throw new Error(`kickjs-db: migration ${e.id} is in both ${other} and ${folder.name}`)
      }
      seen.set(e.id, folder.name)
      entries.push({ ...e, folder })
    }
  }
  return folders.length > 1 ? entries.toSorted((a, b) => a.id.localeCompare(b.id)) : entries
}

/** The folder holding an applied migration. */
async function folderOf(id: string, opts: RunnerOptions): Promise<MigrationFolder> {
  const entry = (await readJournals(opts.migrationsDir, opts.adapter.dialect)).find(
    (e) => e.id === id,
  )
  if (!entry) throw new Error(`kickjs-db: migration ${id} is applied but in no migrations folder`)
  return entry.folder
}

async function withLock<T>(opts: RunnerOptions, fn: () => Promise<T>): Promise<T> {
  const owner = opts.owner ?? `${process.pid}@${new Date().toISOString()}`
  const got = await opts.adapter.acquireLock(owner)
  if (!got) {
    throw new MigrationLockError(
      'Another process holds the migration lock. If none is running — a deploy was killed mid-migration — release it with `kick db migrate unlock`.',
    )
  }
  try {
    return await fn()
  } finally {
    await opts.adapter.releaseLock()
  }
}

/**
 * Verify pending entries. A reviewed migration must still match the hash
 * `review` recorded — an edit after review is refused (MigrationHashError).
 * An unreviewed one is refused when `requireReviewed` (UnreviewedMigrationError);
 * otherwise — development — it applies as it stands, edits included, and is
 * recorded with its current hash.
 */
async function verifyPending(pending: PreparedEntry[], requireReviewed: boolean): Promise<void> {
  for (const entry of pending) {
    const meta = await readMeta(entry.folder, entry.id)
    const actualHash = await currentHash(entry.folder, entry.id)
    if (meta.reviewed === true) {
      if (actualHash !== entry.hash) throw new MigrationHashError(entry.id, entry.hash, actualHash)
    } else if (requireReviewed) {
      throw new UnreviewedMigrationError(entry.id)
    } else {
      entry.hash = actualHash
    }
  }
}

async function applyEntry(entry: PreparedEntry, batch: number, opts: RunnerOptions): Promise<void> {
  const upSql = await readRequired(entry.folder, entry.id, 'up.sql')
  const meta = await readMeta(entry.folder, entry.id)
  const useTx = meta.transaction !== false

  // Enum-drop gate runs before any DB write so the runner can refuse
  // a destructive migration without partial application.
  enforceEnumDropGate(entry.id, upSql, opts.confirmEnumDrop ?? false)

  const record = {
    id: entry.id,
    name: entry.tag,
    hash: entry.hash,
    batch,
    direction: 'up' as const,
  }
  const { adapter } = opts
  try {
    const code = await entry.folder.code(entry.id)
    if (code) {
      await runCodeMigration(code, entry.id, 'up', adapter, useTx, { record })
      return
    }
    if (useTx && adapter.applyMigrationInTx) {
      // The row commits with the migration — a crash can't leave one without the other.
      await adapter.applyMigrationInTx(upSql, { record })
      return
    }
    if (useTx) {
      await adapter.applySqlInTx(upSql)
    } else {
      await adapter.applySqlNoTx(upSql)
    }
  } catch (err) {
    throw new MigrationFailedError(entry.id, err)
  }
  await adapter.recordApplied(record)
}

async function runForward(opts: RunnerOptions, pending: PreparedEntry[]): Promise<AppliedSummary> {
  if (pending.length === 0) {
    return { applied: [], batch: null }
  }

  const requireReviewed = opts.requireReviewed ?? process.env.NODE_ENV !== 'development'
  await verifyPending(pending, requireReviewed)

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
  const entries = await readJournals(opts.migrationsDir, opts.adapter.dialect)
  const applied = await opts.adapter.listApplied()
  const appliedIds = new Set(applied.map((r) => r.id))
  return entries
    .filter((e) => !appliedIds.has(e.id))
    .map((e) => ({ id: e.id, tag: e.tag, hash: e.hash, folder: e.folder }))
}

function mergeSnapshots(a: SchemaSnapshot, b: SchemaSnapshot): SchemaSnapshot {
  const merged: SchemaSnapshot = { ...a, tables: { ...a.tables, ...b.tables } }
  if (a.enums || b.enums) merged.enums = { ...a.enums, ...b.enums }
  if (a.schemas || b.schemas)
    merged.schemas = [...new Set([...(a.schemas ?? []), ...(b.schemas ?? [])])].toSorted()
  return merged
}

async function maybeCheckDrift(opts: RunnerOptions): Promise<void> {
  const behavior = opts.driftCheck ?? 'error'
  if (behavior === 'ignore') return
  const applied = await opts.adapter.listApplied()
  if (applied.length === 0) return // nothing to compare against
  // The schema the migrations expect: per folder, the snapshot of its most
  // recently applied migration — merged when there are several folders, each
  // owning its own tables.
  const appliedIds = new Set(applied.map((r) => r.id))
  const latestPerDir = new Map<MigrationFolder, string>()
  for (const e of await readJournals(opts.migrationsDir, opts.adapter.dialect)) {
    if (appliedIds.has(e.id)) latestPerDir.set(e.folder, e.id)
  }
  let expected: SchemaSnapshot | undefined
  try {
    for (const [folder, id] of latestPerDir) {
      const snap = JSON.parse(await readRequired(folder, id, 'snapshot.json')) as SchemaSnapshot
      expected = expected ? mergeSnapshots(expected, snap) : snap
    }
  } catch {
    return // snapshot missing — diagnostic, not fatal here
  }
  if (!expected) return
  const live = await opts.adapter.introspect()
  await checkDrift(live, expected, behavior, opts.log)
}

export async function migrateLatest(opts: RunnerOptions): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    await maybeCheckDrift(opts)
    const pending = await listPending(opts)
    return runForward(opts, pending)
  })
}

/**
 * A migration named by its full id (`20261003_120000_add_users`) or its name
 * (`add_users`).
 */
function isNamed(id: string, name: string, target: string): boolean {
  return id === target || name === target
}

/**
 * Apply the next pending migration — or, with `to`, every pending one up to
 * and including that migration.
 */
export async function migrateUp(opts: RunnerOptions & { to?: string }): Promise<AppliedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    await maybeCheckDrift(opts)
    const pending = await listPending(opts)
    if (opts.to === undefined) return runForward(opts, pending.slice(0, 1))
    const at = pending.findIndex((e) => isNamed(e.id, e.tag, opts.to!))
    if (at === -1) {
      throw new Error(`kickjs-db: no pending migration named '${opts.to}' to migrate up to`)
    }
    return runForward(opts, pending.slice(0, at + 1))
  })
}

export interface ReversedSummary {
  /** The last migration reversed, or null when there was none. */
  reversed: string | null
  /** Every migration reversed, in the order it happened. */
  reversedAll: string[]
}

async function applyReverse(id: string, opts: RunnerOptions): Promise<void> {
  const folder = await folderOf(id, opts)
  const downSql = await readRequired(folder, id, 'down.sql')
  const meta = await readMeta(folder, id)
  const requireReviewed = opts.requireReviewed ?? process.env.NODE_ENV !== 'development'
  if (requireReviewed && meta.reviewed !== true) {
    throw new UnreviewedMigrationError(id)
  }
  const useTx = meta.transaction !== false
  const { adapter } = opts
  const code = await folder.code(id)
  if (code) {
    await runCodeMigration(code, id, 'down', adapter, useTx, { remove: id })
    return
  }
  if (useTx && adapter.applyMigrationInTx) {
    await adapter.applyMigrationInTx(downSql, { remove: id })
    return
  }
  if (useTx) {
    await adapter.applySqlInTx(downSql)
  } else {
    await adapter.applySqlNoTx(downSql)
  }
  await adapter.removeApplied(id)
}

/**
 * Reverse the most recent migration — or, with `to`, every one applied after
 * that migration, which stays applied.
 */
export async function migrateDown(opts: RunnerOptions & { to?: string }): Promise<ReversedSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: null, reversedAll: [] }
    // Sort by batch then appliedAt so 'most recent' is unambiguous even if
    // two migrations share a batch number (same `migrate latest` run).
    const sorted = [...applied].toSorted((a, b) =>
      a.batch !== b.batch ? a.batch - b.batch : a.appliedAt.localeCompare(b.appliedAt),
    )
    let targets = sorted.slice(-1)
    if (opts.to !== undefined) {
      const at = sorted.findIndex((r) => isNamed(r.id, r.name, opts.to!))
      if (at === -1) {
        throw new Error(`kickjs-db: no applied migration named '${opts.to}' to migrate down to`)
      }
      targets = sorted.slice(at + 1)
    }
    const reversedAll: string[] = []
    for (const row of targets.toReversed()) {
      await applyReverse(row.id, opts)
      reversedAll.push(row.id)
    }
    return { reversed: reversedAll.at(-1) ?? null, reversedAll }
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
  const journal = await readJournals(opts.migrationsDir, opts.adapter.dialect)
  const applied = await opts.adapter.listApplied()
  const byId = new Map(applied.map((r) => [r.id, r]))

  const entries: StatusEntry[] = []
  for (const e of journal) {
    const row = byId.get(e.id)
    let reviewed = false
    try {
      reviewed = (await readMeta(e.folder, e.id)).reviewed === true
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

/** Reverse the last batch — or, with `all`, every applied migration. */
export async function migrateRollback(
  opts: RunnerOptions & { all?: boolean },
): Promise<RollbackSummary> {
  await opts.adapter.ensureMigrationTables()
  return withLock(opts, async () => {
    const applied = await opts.adapter.listApplied()
    if (applied.length === 0) return { reversed: [], batch: null }

    const lastBatch = Math.max(...applied.map((r) => r.batch))
    // Reverse-applied order so teardown matches dependencies (drop FK before
    // drop table etc).
    const targets = applied
      .filter((r) => opts.all || r.batch === lastBatch)
      .toSorted((a, b) =>
        a.batch !== b.batch ? a.batch - b.batch : a.appliedAt.localeCompare(b.appliedAt),
      )
      .toReversed()

    const reversed: string[] = []
    for (const row of targets) {
      await applyReverse(row.id, opts)
      reversed.push(row.id)
    }
    return { reversed, batch: lastBatch }
  })
}
