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
  /**
   * When true, skip the schema diff and emit an empty migration shell
   * (up.sql / down.sql with just the REVIEWED header, snapshot.json copying
   * the prior schema state). Used for data migrations, seed inserts, or any
   * change the diff engine can't author. Matches knex's `migrate:make`.
   */
  empty?: boolean
}

export interface GenerateResult {
  status: 'created' | 'no-changes'
  migrationDir?: string
  changeCount: number
  empty?: boolean
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const migrationsAbs = path.resolve(opts.cwd, opts.config.migrationsDir)
  const { snapshot: prev, id: previousId } = await readLatestSnapshotEntry(migrationsAbs)

  if (opts.empty) {
    return await writeMigration({
      opts,
      migrationsAbs,
      previousId,
      // Empty migrations don't change schema state — keep the prior snapshot
      // so the next diff-based generate stays consistent.
      target: prev,
      upBody: '',
      downBody: '',
      changeCount: 0,
      draft: false,
      empty: true,
    })
  }

  const schemaAbs = path.resolve(opts.cwd, opts.config.schemaPath)
  const schemaModule = await import(pathToFileURL(schemaAbs).href)
  const target = extractSnapshot(schemaModule, opts.config.dialect)
  const changes = diff(prev, target)

  if (changes.length === 0) {
    return { status: 'no-changes', changeCount: 0 }
  }

  return await writeMigration({
    opts,
    migrationsAbs,
    previousId,
    target,
    upBody: emitPg(changes),
    downBody: emitPg(invertChanges(changes)),
    changeCount: changes.length,
    draft: hasAmbiguousReverse(changes),
    empty: false,
  })
}

interface WriteMigrationParams {
  opts: GenerateOptions
  migrationsAbs: string
  previousId: string | null
  target: SchemaSnapshot
  upBody: string
  downBody: string
  changeCount: number
  draft: boolean
  empty: boolean
}

async function writeMigration(p: WriteMigrationParams): Promise<GenerateResult> {
  const id = formatId(p.opts.now?.() ?? new Date(), p.opts.name)
  const dir = path.join(p.migrationsAbs, id)
  await mkdir(dir, { recursive: true })

  const upHeader = '-- REVIEWED: false\n'
  const upHint = p.empty
    ? '-- Empty migration — author SQL below (data migration, seed, etc).\n'
    : ''
  const upSql = upHeader + upHint + p.upBody + (p.upBody ? '\n' : '')
  await writeFile(path.join(dir, 'up.sql'), upSql, 'utf8')

  const downHeader = '-- REVIEWED: false\n'
  const downDraft = p.draft
    ? '-- DRAFT: ambiguous reverses present (drop column / drop table / type change). Audit before applying.\n'
    : ''
  const downHint = p.empty ? '-- Empty migration — author the reverse SQL here.\n' : ''
  const downSql = downHeader + downDraft + downHint + p.downBody + (p.downBody ? '\n' : '')
  await writeFile(path.join(dir, 'down.sql'), downSql, 'utf8')

  await writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(p.target, null, 2) + '\n', 'utf8')

  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        id,
        name: p.opts.name,
        createdAt: (p.opts.now?.() ?? new Date()).toISOString(),
        reviewed: false,
        dialect: p.opts.config.dialect,
        previousId: p.previousId,
        downIsDraft: p.draft,
        empty: p.empty,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  return { status: 'created', migrationDir: dir, changeCount: p.changeCount, empty: p.empty }
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
