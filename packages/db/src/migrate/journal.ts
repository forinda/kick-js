import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Dialect } from '../snapshot/types'
import { codeMigrationFile } from './code-migration'

export interface JournalEntry {
  id: string
  tag: string
  hash: string
  createdAt: string
}

export interface Journal {
  version: 1
  dialect: Dialect
  entries: JournalEntry[]
}

const FILE = '_journal.json'

export async function readJournal(migrationsDir: string, dialect: Dialect): Promise<Journal> {
  const file = path.join(migrationsDir, FILE)
  if (!existsSync(file)) {
    return { version: 1, dialect, entries: [] }
  }
  const raw = JSON.parse(await readFile(file, 'utf8'))
  if (raw.version !== 1) {
    throw new Error(`_journal.json version ${raw.version} unsupported (expected 1)`)
  }
  return raw
}

export async function appendJournalEntry(
  migrationsDir: string,
  dialect: Dialect,
  entry: JournalEntry,
): Promise<void> {
  const j = await readJournal(migrationsDir, dialect)
  j.entries.push(entry)
  const file = path.join(migrationsDir, FILE)
  await writeFile(file, JSON.stringify(j, null, 2) + '\n', 'utf8')
}

export async function computeMigrationHash(migrationDir: string): Promise<string> {
  const up = await readFile(path.join(migrationDir, 'up.sql'), 'utf8')
  const down = await readFile(path.join(migrationDir, 'down.sql'), 'utf8')
  const snap = await readFile(path.join(migrationDir, 'snapshot.json'), 'utf8')
  const h = createHash('sha256').update(up).update('|').update(down).update('|').update(snap)
  // A migration written in TypeScript is hashed with its code too. Only when
  // there is some, so every SQL migration keeps the hash it was recorded with.
  const code = codeMigrationFile(migrationDir)
  if (code) h.update('|').update(await readFile(code, 'utf8'))
  return `sha256:${h.digest('hex')}`
}

export async function verifyMigrationHash(
  migrationDir: string,
  expected: string,
): Promise<boolean> {
  const actual = await computeMigrationHash(migrationDir)
  return actual === expected
}
