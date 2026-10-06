/**
 * Where the runner reads migrations from: a folder on disk, or the files
 * themselves — bundled into the app for a deploy with no migrations folder
 * (serverless, edge). Both are read the same way, so hashing and review work
 * alike.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { CODE_MIGRATION_FILES, loadCodeMigration, type CodeMigration } from './code-migration'

/** Migration files held in memory — what `migrationFiles()` returns. */
export interface MigrationFiles {
  readonly __migrationFiles: true
  /** File text by `_journal.json` or `<id>/<file>`. */
  readonly files: ReadonlyMap<string, string>
  /** Loaded `migration.ts` modules by migration id. */
  readonly modules: ReadonlyMap<string, CodeMigration>
}

/** Where migrations live: a folder, bundled files, or several of either, run as one history. */
export type MigrationsLocation = string | MigrationFiles | readonly (string | MigrationFiles)[]

/** The part of a path the runner reads by: `_journal.json` or `<id>/<file>`. */
function keyOf(file: string): string {
  const parts = file.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) === '_journal.json' ? '_journal.json' : parts.slice(-2).join('/')
}

/**
 * Migrations from files already in memory, keyed by path — what a bundler's
 * glob gives you — for a deploy that ships no migrations folder:
 *
 * ```ts
 * const migrations = migrationFiles(
 *   import.meta.glob('../../db/migrations/**', { query: '?raw', import: 'default', eager: true }),
 *   import.meta.glob('../../db/migrations/*\/migration.ts', { eager: true }),
 * )
 * ```
 *
 * `files` must be the files' exact text (`?raw`): the runner hashes it to
 * check a reviewed migration wasn't changed. A migration written in
 * TypeScript needs both: its text in `files`, its module in `modules`.
 */
export function migrationFiles(
  files: Record<string, string>,
  modules: Record<string, unknown> = {},
): MigrationFiles {
  const byKey = new Map<string, string>()
  for (const [file, text] of Object.entries(files)) {
    if (typeof text !== 'string') {
      throw new Error(
        `kickjs-db: migrationFiles() got ${typeof text} for ${file} — pass each file's text (import.meta.glob with { query: '?raw', import: 'default' })`,
      )
    }
    byKey.set(keyOf(file), text)
  }
  const byId = new Map<string, CodeMigration>()
  for (const [file, mod] of Object.entries(modules)) {
    byId.set(keyOf(file).split('/')[0]!, mod as CodeMigration)
  }
  return { __migrationFiles: true, files: byKey, modules: byId }
}

export function isMigrationFiles(value: unknown): value is MigrationFiles {
  return (value as MigrationFiles | undefined)?.__migrationFiles === true
}

/** One place migrations are read from. */
export interface MigrationFolder {
  /** For messages: the folder's path, or `bundled migrations`. */
  readonly name: string
  /** A file's text — `_journal.json` or `<id>/<file>` — or undefined when there's none. */
  read(file: string): Promise<string | undefined>
  /** A migration's TypeScript, if it's written in it: the module and its text. */
  code(id: string): Promise<{ migration: CodeMigration; text: string; file: string } | undefined>
}

function diskFolder(dir: string): MigrationFolder {
  return {
    name: dir,
    async read(file) {
      const p = path.join(dir, file)
      return existsSync(p) ? readFile(p, 'utf8') : undefined
    },
    async code(id) {
      for (const name of CODE_MIGRATION_FILES) {
        const file = path.join(dir, id, name)
        if (!existsSync(file)) continue
        return {
          migration: await loadCodeMigration(file, id),
          text: await readFile(file, 'utf8'),
          file: name,
        }
      }
      return undefined
    },
  }
}

function bundledFolder(source: MigrationFiles): MigrationFolder {
  return {
    name: 'bundled migrations',
    async read(file) {
      return source.files.get(file)
    },
    async code(id) {
      const name = CODE_MIGRATION_FILES.find((f) => source.files.has(`${id}/${f}`))
      const migration = source.modules.get(id)
      if (!name && !migration) return undefined
      if (!name) {
        throw new Error(
          `kickjs-db: migration ${id} is written in TypeScript — pass its migration.ts text in migrationFiles()'s files too, for its hash`,
        )
      }
      if (!migration || typeof migration.up !== 'function') {
        throw new Error(
          `kickjs-db: migration ${id} is written in TypeScript — pass its module in migrationFiles()'s modules (it must export up(db))`,
        )
      }
      return { migration, text: source.files.get(`${id}/${name}`)!, file: name }
    },
  }
}

export function migrationFolders(location: MigrationsLocation): MigrationFolder[] {
  const all = typeof location === 'string' || isMigrationFiles(location) ? [location] : location
  return all.map((l) => (typeof l === 'string' ? diskFolder(l) : bundledFolder(l)))
}
