import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { computeMigrationHash } from './journal'
import type { Journal } from './journal'

export interface ReviewResult {
  id: string
  /** True when the migration was already reviewed (no-op). */
  alreadyReviewed: boolean
}

/**
 * Mark a migration as reviewed: flip `meta.json.reviewed` to `true`,
 * swap the `-- REVIEWED: false` markers in `up.sql` / `down.sql` to
 * `true`, and recompute the migration's journal hash (the marker swap
 * changes the file bytes, so the stored hash must follow or the runner's
 * integrity check would fail).
 *
 * This is the single source of truth for "reviewing" — adopters should
 * never hand-edit `meta.json`, because that leaves the `-- REVIEWED`
 * markers and the journal hash out of sync.
 */
export async function reviewMigration(migrationsDir: string, id: string): Promise<ReviewResult> {
  const dir = path.join(migrationsDir, id)
  const metaPath = path.join(dir, 'meta.json')
  if (!existsSync(metaPath)) {
    throw new Error(`kickjs-db: migration '${id}' not found under ${migrationsDir}`)
  }

  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { reviewed?: boolean }
  if (meta.reviewed === true) {
    return { id, alreadyReviewed: true }
  }

  // 1. Flip the human-facing markers in the SQL files.
  for (const file of ['up.sql', 'down.sql']) {
    const p = path.join(dir, file)
    if (!existsSync(p)) continue
    const sql = await readFile(p, 'utf8')
    await writeFile(p, sql.replace(/^-- REVIEWED: false$/m, '-- REVIEWED: true'), 'utf8')
  }

  // 2. Flip the gate in meta.json (the value the runner actually checks).
  meta.reviewed = true
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  // 3. Recompute the journal hash — the marker swap changed up/down.sql.
  const journalPath = path.join(migrationsDir, '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal
  const entry = journal.entries.find((e) => e.id === id)
  if (entry) {
    entry.hash = await computeMigrationHash(dir)
    await writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n', 'utf8')
  }

  return { id, alreadyReviewed: false }
}
