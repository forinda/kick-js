import { existsSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'

const CONFIG_FILENAMES = ['kick.config.ts', 'kick.config.js', 'kick.config.mjs', 'kick.config.json']

/**
 * Walk up from `startDir` looking for the project root. A directory
 * counts as the root when it contains any of:
 * - `kick.config.{ts,js,mjs,json}` (strongest signal)
 * - `package.json` (fallback when no config file exists yet)
 *
 * Returns the absolute path of the first matching directory, or
 * `startDir` itself when nothing was found (no surprises — callers
 * that didn't find a config still get a reasonable cwd).
 *
 * `kick.config.*` wins over `package.json` when both appear at
 * different levels, so adopters running `kick typegen` from `src/`
 * land on the project root that owns the config, not on the nearest
 * workspace package boundary in a monorepo.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  const start = resolve(startDir)
  const { root: fsRoot } = parse(start)

  let firstPackageJson: string | null = null
  let cursor = start
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      if (existsSync(resolve(cursor, name))) return cursor
    }
    if (firstPackageJson === null && existsSync(resolve(cursor, 'package.json'))) {
      firstPackageJson = cursor
    }
    if (cursor === fsRoot) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  return firstPackageJson ?? start
}
