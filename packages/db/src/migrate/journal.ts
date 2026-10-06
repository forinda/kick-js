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
  return parseJournal(existsSync(file) ? await readFile(file, 'utf8') : undefined, dialect)
}

/** A journal from its text; none yet is an empty one. */
export function parseJournal(text: string | undefined, dialect: Dialect): Journal {
  if (text === undefined) return { version: 1, dialect, entries: [] }
  const raw = JSON.parse(text)
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
  const code = codeMigrationFile(migrationDir)
  return hashMigration(
    await readFile(path.join(migrationDir, 'up.sql'), 'utf8'),
    await readFile(path.join(migrationDir, 'down.sql'), 'utf8'),
    await readFile(path.join(migrationDir, 'snapshot.json'), 'utf8'),
    code ? await readFile(code, 'utf8') : undefined,
  )
}

/** A migration's hash from its files' text. */
export function hashMigration(up: string, down: string, snapshot: string, code?: string): string {
  const h = createHash('sha256').update(up).update('|').update(down).update('|').update(snapshot)
  // A migration written in TypeScript is hashed with its code too. Only when
  // there is some, so every SQL migration keeps the hash it was recorded with.
  if (code !== undefined) h.update('|').update(code)
  return `sha256:${h.digest('hex')}`
}

export async function verifyMigrationHash(
  migrationDir: string,
  expected: string,
): Promise<boolean> {
  const actual = await computeMigrationHash(migrationDir)
  return actual === expected
}
