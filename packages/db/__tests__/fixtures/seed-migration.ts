import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { computeMigrationHash, appendJournalEntry } from '@forinda/kickjs-db'
import type { Dialect } from '@forinda/kickjs-db'

/**
 * Seeds a fake migration directory + journal entry for runner tests so we
 * don't have to call the full generate() pipeline. Each migration creates a
 * tiny CREATE/DROP statement so applySqlInTx has something realistic to
 * record (the MemoryMigrationAdapter just stores it as a string).
 */
export async function seedMigration(
  migrationsDir: string,
  id: string,
  name: string,
  opts: { reviewed?: boolean; dialect?: Dialect } = {},
): Promise<string> {
  const reviewed = opts.reviewed ?? true
  const dialect = opts.dialect ?? 'postgres'
  const dir = path.join(migrationsDir, id)
  await mkdir(dir, { recursive: true })

  const upHeader = `-- REVIEWED: ${reviewed}\n`
  await writeFile(path.join(dir, 'up.sql'), upHeader + `CREATE TABLE "${id}_t" ();`, 'utf8')
  await writeFile(path.join(dir, 'down.sql'), upHeader + `DROP TABLE "${id}_t";`, 'utf8')
  await writeFile(
    path.join(dir, 'snapshot.json'),
    JSON.stringify({ version: 1, dialect, tables: {} }),
    'utf8',
  )
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ id, name, reviewed, dialect, previousId: null, downIsDraft: false }),
    'utf8',
  )

  const hash = await computeMigrationHash(dir)
  await appendJournalEntry(migrationsDir, dialect, {
    id,
    tag: name,
    hash,
    createdAt: new Date().toISOString(),
  })
  return dir
}
