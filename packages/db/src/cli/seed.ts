/**
 * `kick db seed` — run the seed files in `seedsDir`: data a fresh database
 * needs (roles, a first admin, reference rows) or a developer wants (sample
 * data). Each file default-exports an async function, imports whatever client
 * it needs, and should be safe to run again — `db.upsert()` and
 * `db.findOrCreate()` make that easy. Nothing is recorded: seeds aren't
 * migrations.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { loadModule } from './load-module'

import { KickDbError } from '../errors'

const SEED_FILE = /\.(?:[cm]?[jt]s)$/

export interface SeedResult {
  /** The seed files run, in order. */
  ran: string[]
}

/** The seed files in `dir`, sorted by name — prefix them (`01_roles.ts`) to order them. */
export async function listSeeds(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  return (await readdir(dir))
    .filter((f) => SEED_FILE.test(f) && !f.endsWith('.d.ts') && !/\.test\.[cm]?[jt]s$/.test(f))
    .toSorted()
}

/**
 * Run every seed in `dir`, or only `names` (file names, with or without the
 * extension), in name order. A seed that throws stops the run: the error
 * names the file and keeps the original as `cause`.
 */
export async function runSeeds(opts: { dir: string; names?: string[] }): Promise<SeedResult> {
  const all = await listSeeds(opts.dir)
  const strip = (f: string) => f.replace(SEED_FILE, '')
  const wanted = opts.names?.length ? new Set(opts.names.map(strip)) : null
  const files = wanted ? all.filter((f) => wanted.has(strip(f))) : all

  if (wanted) {
    const missing = [...wanted].filter((n) => !files.some((f) => strip(f) === n))
    if (missing.length > 0) {
      throw new KickDbError(
        'KICK_DB_SEED_NOT_FOUND',
        `No seed named ${missing.join(', ')} in ${opts.dir}`,
      )
    }
  }

  const ran: string[] = []
  for (const file of files) {
    const mod = (await loadModule(path.join(opts.dir, file))) as { default?: unknown }
    if (typeof mod.default !== 'function') {
      throw new KickDbError(
        'KICK_DB_SEED_INVALID',
        `Seed ${file} must default-export a function: export default async function seed() { … }`,
      )
    }
    try {
      await mod.default()
    } catch (cause) {
      const err = new KickDbError(
        'KICK_DB_SEED_FAILED',
        `Seed ${file} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      err.cause = cause
      throw err
    }
    ran.push(file)
  }
  return { ran }
}
