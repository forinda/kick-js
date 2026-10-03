import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadModule } from './load-module'

import type { DbConfig } from './config'
import { diff } from '../diff/engine'
import { computeMigrationHash, readJournal } from '../migrate/journal'
import { extractSnapshot } from '../snapshot/extract'
import { readLatestSnapshotEntry } from './generate'

export interface CheckResult {
  /** Changes in the schema that no migration covers yet — run `kick db generate`. */
  unmigratedChanges: number
  /** Migrations not marked reviewed — the runner refuses them outside development. */
  unreviewed: string[]
  /** Reviewed migrations whose files changed after review — the runner refuses them. */
  modified: string[]
  ok: boolean
}

/**
 * Everything `migrate latest` would refuse, found without a database — for
 * CI, before a deploy reaches one: the schema has changes no migration
 * covers, a migration is unreviewed, or a migration was edited after review.
 */
export async function checkMigrations(opts: {
  config: DbConfig
  cwd: string
}): Promise<CheckResult> {
  const migrationsAbs = path.resolve(opts.cwd, opts.config.migrationsDir)
  const { snapshot: prev } = await readLatestSnapshotEntry(migrationsAbs, opts.config.dialect)
  const schemaModule = await loadModule(path.resolve(opts.cwd, opts.config.schemaPath), {
    fresh: true,
  })
  const unmigratedChanges = diff(
    prev,
    extractSnapshot(schemaModule, opts.config.dialect, { casing: opts.config.casing }),
  ).length

  // Every folder the runner applies is checked for unreviewed or edited
  // migrations. The schema is compared with `migrationsDir` only: the other
  // folders belong to schemas of their own.
  const unreviewed: string[] = []
  const modified: string[] = []
  const folders = [opts.config.migrationsDir, ...(opts.config.migrationsDirs ?? [])].map((d) =>
    path.resolve(opts.cwd, d),
  )
  for (const folder of folders) {
    if (!existsSync(folder)) continue
    for (const entry of (await readJournal(folder, opts.config.dialect)).entries) {
      const dir = path.join(folder, entry.id)
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as {
        reviewed?: boolean
      }
      // An unreviewed migration is a draft — edits are expected until review.
      if (meta.reviewed !== true) unreviewed.push(entry.id)
      else if ((await computeMigrationHash(dir)) !== entry.hash) modified.push(entry.id)
    }
  }

  return {
    unmigratedChanges,
    unreviewed,
    modified,
    ok: unmigratedChanges === 0 && unreviewed.length === 0 && modified.length === 0,
  }
}
