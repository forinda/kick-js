import path from 'node:path'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

import { extractSnapshot } from '../snapshot/extract'
import { diff } from '../diff/engine'
import { invertChanges, hasAmbiguousReverse } from '../diff/invert'
import { CompositeEnumReferenceError, type CompositeRef } from '../diff/composite-detect'
import { emitPg } from '../emit/pg'
import { emitSqlite } from '../emit/sqlite'
import { appendJournalEntry, computeMigrationHash } from '../migrate/journal'
import type { DbConfig } from './config'
import type { ChangeSet } from '../diff/types'
import type { Dialect, SchemaSnapshot } from '../snapshot/types'
import type { Change, RemoveEnumValue } from '../diff/types'

/** Pick the migration SQL emitter for the configured dialect. */
function emitterFor(dialect: Dialect): (changes: ChangeSet) => string {
  if (dialect === 'sqlite') return emitSqlite
  // MySQL has no dedicated emitter yet — it falls back to the Postgres
  // DDL, which is close but not guaranteed to run. Tracked separately.
  return emitPg
}

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
  /**
   * M4.C — generate-time gate for `removeEnumValue` changes. When the
   * diff produces one or more, this callback is invoked once per
   * affected enum to surface PG composite-type references. A non-empty
   * result aborts generate with `CompositeEnumReferenceError` (the
   * rename-recreate USING-cast can't reach into composite fields).
   *
   * Optional: when omitted, generate skips the check (no DB connection
   * required). The CLI wires this for `dialect=postgres` workflows.
   */
  detectCompositeRefs?: (enumName: string) => Promise<readonly CompositeRef[]>
}

export interface GenerateResult {
  status: 'created' | 'no-changes'
  migrationDir?: string
  changeCount: number
  empty?: boolean
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const migrationsAbs = path.resolve(opts.cwd, opts.config.migrationsDir)
  const { snapshot: prev, id: previousId } = await readLatestSnapshotEntry(
    migrationsAbs,
    opts.config.dialect,
  )

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

  await assertNoCompositeReferences(changes, opts.detectCompositeRefs)

  const emit = emitterFor(opts.config.dialect)
  return await writeMigration({
    opts,
    migrationsAbs,
    previousId,
    target,
    upBody: emit(changes),
    downBody: emit(invertChanges(changes)),
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

  // Append to _journal.json so the runner has the canonical applied-order
  // and integrity hash. Hash includes up + down + snapshot, so any later
  // hand-edit of those files will surface as a MigrationHashError at apply.
  const hash = await computeMigrationHash(dir)
  await appendJournalEntry(p.migrationsAbs, p.opts.config.dialect, {
    id,
    tag: p.opts.name,
    hash,
    createdAt: (p.opts.now?.() ?? new Date()).toISOString(),
  })

  return { status: 'created', migrationDir: dir, changeCount: p.changeCount, empty: p.empty }
}

interface LatestEntry {
  snapshot: SchemaSnapshot
  id: string | null
}

async function readLatestSnapshotEntry(
  migrationsDir: string,
  dialect: Dialect,
): Promise<LatestEntry> {
  const empty: SchemaSnapshot = { version: 1, dialect, tables: {} }
  if (!existsSync(migrationsDir)) {
    return { snapshot: empty, id: null }
  }
  const entries = await readdir(migrationsDir)
  const dirs = entries.filter((e) => /^\d{8}_\d{6}_/.test(e)).toSorted()
  if (dirs.length === 0) {
    return { snapshot: empty, id: null }
  }
  const latest = dirs[dirs.length - 1]
  const file = path.join(migrationsDir, latest, 'snapshot.json')
  const snapshot = JSON.parse(await readFile(file, 'utf8')) as SchemaSnapshot
  return { snapshot, id: latest }
}

/**
 * M4.C gate. Walk the diff for `removeEnumValue` changes; if any are
 * present and the caller supplied a composite-detector, run it once
 * per enum and aggregate the references. Throws
 * `CompositeEnumReferenceError` when any references are found so the
 * operator restructures the composite before the migration is
 * committed to disk.
 */
async function assertNoCompositeReferences(
  changes: readonly Change[],
  detect: ((enumName: string) => Promise<readonly CompositeRef[]>) | undefined,
): Promise<void> {
  if (!detect) return
  const removals = changes.filter((c): c is RemoveEnumValue => c.kind === 'removeEnumValue')
  if (removals.length === 0) return

  const allRefs: CompositeRef[] = []
  // Detect once per distinct enum — multiple removals on the same enum
  // collapse into a single check; the caller probably batched them.
  const seen = new Set<string>()
  for (const r of removals) {
    if (seen.has(r.enum)) continue
    seen.add(r.enum)
    const refs = await detect(r.enum)
    allRefs.push(...refs)
  }
  if (allRefs.length > 0) {
    throw new CompositeEnumReferenceError(allRefs)
  }
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
