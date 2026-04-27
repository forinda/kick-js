import path from 'node:path'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

import { extractSnapshot } from '../snapshot/extract'
import { diff } from '../diff/engine'
import { invertChanges, hasAmbiguousReverse } from '../diff/invert'
import { emitPg } from '../emit/pg'
import type { DbConfig } from './config'
import type { SchemaSnapshot } from '../snapshot/types'

export interface GenerateOptions {
  name: string
  config: DbConfig
  cwd: string
  now?: () => Date
}

export interface GenerateResult {
  status: 'created' | 'no-changes'
  migrationDir?: string
  changeCount: number
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const schemaAbs = path.resolve(opts.cwd, opts.config.schemaPath)
  const migrationsAbs = path.resolve(opts.cwd, opts.config.migrationsDir)

  const schemaModule = await import(pathToFileURL(schemaAbs).href)
  const target = extractSnapshot(schemaModule, opts.config.dialect)

  const { snapshot: prev, id: previousId } = await readLatestSnapshotEntry(migrationsAbs)
  const changes = diff(prev, target)

  if (changes.length === 0) {
    return { status: 'no-changes', changeCount: 0 }
  }

  const id = formatId(opts.now?.() ?? new Date(), opts.name)
  const dir = path.join(migrationsAbs, id)
  await mkdir(dir, { recursive: true })

  const upSql = '-- REVIEWED: false\n' + emitPg(changes) + '\n'
  await writeFile(path.join(dir, 'up.sql'), upSql, 'utf8')

  const draft = hasAmbiguousReverse(changes)
  const downSql =
    '-- REVIEWED: false\n' +
    (draft
      ? '-- DRAFT: ambiguous reverses present (drop column / drop table / type change). Audit before applying.\n'
      : '') +
    emitPg(invertChanges(changes)) +
    '\n'
  await writeFile(path.join(dir, 'down.sql'), downSql, 'utf8')

  await writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(target, null, 2) + '\n', 'utf8')

  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        id,
        name: opts.name,
        createdAt: (opts.now?.() ?? new Date()).toISOString(),
        reviewed: false,
        dialect: opts.config.dialect,
        previousId,
        downIsDraft: draft,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  return { status: 'created', migrationDir: dir, changeCount: changes.length }
}

interface LatestEntry {
  snapshot: SchemaSnapshot
  id: string | null
}

async function readLatestSnapshotEntry(migrationsDir: string): Promise<LatestEntry> {
  const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }
  if (!existsSync(migrationsDir)) {
    return { snapshot: empty, id: null }
  }
  const entries = await readdir(migrationsDir)
  const dirs = entries.filter((e) => /^\d{8}_\d{6}_/.test(e)).sort()
  if (dirs.length === 0) {
    return { snapshot: empty, id: null }
  }
  const latest = dirs[dirs.length - 1]
  const file = path.join(migrationsDir, latest, 'snapshot.json')
  const snapshot = JSON.parse(await readFile(file, 'utf8')) as SchemaSnapshot
  return { snapshot, id: latest }
}

function formatId(date: Date, name: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const ts =
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    '_' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  const slug = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  return `${ts}_${slug}`
}
