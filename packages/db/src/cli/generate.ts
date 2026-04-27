import path from 'node:path'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

import { extractSnapshot } from '../snapshot/extract'
import { diff } from '../diff/engine'
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

  const prev = await readLatestSnapshot(migrationsAbs)
  const changes = diff(prev, target)

  if (changes.length === 0) {
    return { status: 'no-changes', changeCount: 0 }
  }

  const id = formatId(opts.now?.() ?? new Date(), opts.name)
  const dir = path.join(migrationsAbs, id)
  await mkdir(dir, { recursive: true })

  const upSql = '-- REVIEWED: false\n' + emitPg(changes) + '\n'
  await writeFile(path.join(dir, 'up.sql'), upSql, 'utf8')
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
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  return { status: 'created', migrationDir: dir, changeCount: changes.length }
}

async function readLatestSnapshot(migrationsDir: string): Promise<SchemaSnapshot> {
  if (!existsSync(migrationsDir)) {
    return { version: 1, dialect: 'postgres', tables: {} }
  }
  const entries = await readdir(migrationsDir)
  const dirs = entries.filter((e) => /^\d{8}_\d{6}_/.test(e)).sort()
  if (dirs.length === 0) {
    return { version: 1, dialect: 'postgres', tables: {} }
  }
  const latest = dirs[dirs.length - 1]
  const file = path.join(migrationsDir, latest, 'snapshot.json')
  return JSON.parse(await readFile(file, 'utf8')) as SchemaSnapshot
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
