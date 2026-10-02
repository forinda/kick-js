import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import { computeMigrationHash } from './journal'
import type { Journal } from './journal'

export interface ReviewResult {
  id: string
  /** True when the migration was already reviewed — its hash is re-recorded. */
  alreadyReviewed: boolean
}

/**
 * Mark a migration as reviewed: flip `meta.json.reviewed` to `true` —
 * the review state the runner checks — and record the hash of the files
 * as reviewed in the journal, so hand-written or edited SQL applies and a
 * later edit doesn't.
 *
 * Legacy migrations (generated before the provenance banner) still carry
 * `-- REVIEWED: false` markers inside the hashed files; those are swapped
 * first, so the recorded hash covers them.
 */
export async function reviewMigration(migrationsDir: string, id: string): Promise<ReviewResult> {
  const dir = path.join(migrationsDir, id)
  const metaPath = path.join(dir, 'meta.json')
  if (!existsSync(metaPath)) {
    throw new Error(`kickjs-db: migration '${id}' not found under ${migrationsDir}`)
  }

  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { reviewed?: boolean }
  // Reviewing again re-records the hash — how an edit made after review is
  // signed off.
  const alreadyReviewed = meta.reviewed === true

  // 1. Legacy marker migration: swap `-- REVIEWED: false` if present.
  //    New-style files (immutable banner) are left untouched.
  for (const file of ['up.sql', 'down.sql']) {
    const p = path.join(dir, file)
    if (!existsSync(p)) continue
    const sql = await readFile(p, 'utf8')
    const next = sql.replace(/^-- REVIEWED: false$/m, '-- REVIEWED: true')
    if (next !== sql) await writeFile(p, next, 'utf8')
  }

  // 2. Flip the gate in meta.json (the value the runner actually checks).
  if (!alreadyReviewed) {
    meta.reviewed = true
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')
  }

  // 3. Record the hash of what was reviewed. Generated SQL is a draft:
  //    filling in an `--empty` migration or editing a generated one before
  //    review is the point of reviewing, so the journal takes the reviewed
  //    bytes. An edit after this is what the runner refuses.
  const journalPath = path.join(migrationsDir, '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal
  const entry = journal.entries.find((e) => e.id === id)
  if (entry) {
    entry.hash = await computeMigrationHash(dir)
    await writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n', 'utf8')
  }

  return { id, alreadyReviewed }
}
