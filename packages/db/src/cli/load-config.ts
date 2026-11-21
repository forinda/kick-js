/**
 * Reading a db config from a named file: `kick db --config db/staging.ts`.
 * Shared by `kick db` and the standalone `kickjs-db` bin.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { KickDbConfigInput } from '../cli'

/** The named config file: `--config`, else a non-empty `KICK_DB_CONFIG`. */
export function configFileOf(
  opts: { config?: string },
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  // `--config ""` (an unset shell variable) must not quietly mean the db block.
  if (opts.config === '') throw new Error('kickjs-db: --config needs a file path')
  return opts.config || env.KICK_DB_CONFIG || undefined
}

/** Keys a db config may set; a file with none of them (and no `db` block) is the wrong file. */
const DB_KEYS = new Set([
  'schemaPath',
  'migrationsDir',
  'migrationsDirs',
  'seedsDir',
  'dialect',
  'connectionString',
  'adapter',
  'driftCheck',
  'driftIgnore',
  'casing',
  'migrationsTable',
  'tenants',
])

/**
 * A db config file's contents: its default export, or that export's `db` block
 * (a kick.config-style file). `.ts` / `.mts` load through jiti, with the
 * project's tsconfig `paths`; `.json` is parsed; anything else is imported.
 * A relative `file` resolves from the working directory.
 */
export async function loadDbConfigFile(
  file: string,
  cwd = process.cwd(),
): Promise<KickDbConfigInput> {
  const mod = await readConfigModule(file, cwd)
  if (!mod || typeof mod !== 'object')
    throw new Error(
      `kickjs-db: ${file} must export a db config (export default defineKickDbConfig({ … }))`,
    )
  const config = mod as KickDbConfigInput & { db?: KickDbConfigInput }
  if (config.db && typeof config.db === 'object') return config.db
  const keys = Object.keys(config)
  if (keys.length > 0 && !keys.some((k) => DB_KEYS.has(k)))
    throw new Error(
      `kickjs-db: ${file} has no db block and no db settings (found ${keys.join(', ')})`,
    )
  return config
}

/** A config file's default export, as is (`.ts` via jiti, `.json` parsed). */
export async function readConfigModule(file: string, cwd = process.cwd()): Promise<unknown> {
  const abs = path.resolve(cwd, file)
  if (!existsSync(abs)) throw new Error(`kickjs-db: no config file at ${abs}`)
  const mod = await importConfig(abs)
  // No default export: the module namespace isn't a config, however it looks.
  if (!('default' in mod))
    throw new Error(
      `kickjs-db: ${file} has no default export (export default defineKickDbConfig({ … }))`,
    )
  return mod.default
}

/** The file's module: its exports, `default` among them when it has one (JSON is its default). */
async function importConfig(file: string): Promise<{ default?: unknown }> {
  if (file.endsWith('.json')) return { default: JSON.parse(await readFile(file, 'utf8')) }
  if (file.endsWith('.ts') || file.endsWith('.mts')) {
    const { createJiti } = await import('jiti')
    // From the file's own location, with tsconfig `paths`, as the app resolves them.
    const jiti = createJiti(pathToFileURL(file).href, { tsconfigPaths: true })
    return ((await jiti.import(file)) ?? {}) as { default?: unknown }
  }
  return (await import(pathToFileURL(file).href)) as { default?: unknown }
}
