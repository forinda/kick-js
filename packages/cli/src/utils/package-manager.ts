/**
 * Which package manager a project uses — for installing (`kick add`) and for
 * the commands the CLI prints.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadKickConfig, PACKAGE_MANAGERS, type PackageManager } from '../config'

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

/** The package manager of the nearest folder up from `fromDir` holding a lockfile. */
function detectFromLockfile(fromDir: string): PackageManager | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const hit = LOCKFILES.find(([file]) => existsSync(resolve(dir, file)))
    if (hit) return hit[1]
    if (dirname(dir) === dir) return null
  }
}

/**
 * Read `packageManager` from the nearest ancestor `package.json` that
 * declares the field (corepack convention: `"pnpm@10.0.0"`). Climbs so
 * monorepo sub-packages inherit the workspace pm even when their own
 * package.json omits the field.
 */
function packageManagerFromPackageJson(fromDir: string): PackageManager | null {
  let dir: string | null = fromDir
  while (dir) {
    const pkgPath = resolve(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        const field: unknown = pkg.packageManager
        if (typeof field === 'string') {
          const name = field.split('@')[0] as PackageManager
          if (PACKAGE_MANAGERS.includes(name)) return name
        }
      } catch {
        // ignore — keep climbing
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

export type PackageManagerSource = 'flag' | 'config' | 'package.json' | 'lockfile' | 'default'

/**
 * Resolve which package manager to use, in priority order:
 * 1. `--pm` CLI flag
 * 2. `packageManager` in kick.config
 * 3. `packageManager` in nearest ancestor package.json (corepack)
 * 4. The nearest ancestor folder's lockfile
 * 5. `'npm'` fallback
 *
 * Returns the chosen pm plus the source for callers that want to log
 * the resolution path.
 */
export async function resolvePackageManagerWithSource(
  flagPm: string | undefined,
  fromDir = process.cwd(),
): Promise<{ pm: PackageManager; source: PackageManagerSource }> {
  if (flagPm && PACKAGE_MANAGERS.includes(flagPm as PackageManager)) {
    return { pm: flagPm as PackageManager, source: 'flag' }
  }

  const config = await loadKickConfig(fromDir)
  if (config?.packageManager && PACKAGE_MANAGERS.includes(config.packageManager)) {
    return { pm: config.packageManager, source: 'config' }
  }

  const fromPkg = packageManagerFromPackageJson(fromDir)
  if (fromPkg) return { pm: fromPkg, source: 'package.json' }

  const fromLock = detectFromLockfile(fromDir)
  if (fromLock) return { pm: fromLock, source: 'lockfile' }

  return { pm: 'npm', source: 'default' }
}

/** Convenience wrapper for callers that don't care about the source. */
export async function resolvePackageManager(
  flagPm: string | undefined,
  fromDir = process.cwd(),
): Promise<PackageManager> {
  const { pm } = await resolvePackageManagerWithSource(flagPm, fromDir)
  return pm
}

/**
 * The project's package manager without reading kick.config — for messages
 * printed from synchronous code: `packageManager`, then the lockfile, then npm.
 */
export function detectPackageManager(fromDir = process.cwd()): PackageManager {
  return packageManagerFromPackageJson(fromDir) ?? detectFromLockfile(fromDir) ?? 'npm'
}
