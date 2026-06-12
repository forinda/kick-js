import { existsSync, readFileSync } from 'node:fs'
import { platform, release, arch } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'

import { PACKAGE_REGISTRY } from './add'

/**
 * The CLI's own version, read from its package.json — same pattern as
 * cli.ts (`__dirname/../package.json` resolves from dist/ to the
 * package root in both the bundled and source layouts).
 */
function ownVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** npm package names the `kick add` catalog marks as deprecated. */
const DEPRECATED_PKGS = new Set(
  Object.values(PACKAGE_REGISTRY)
    .filter((entry) => entry.deprecated)
    .map((entry) => entry.pkg),
)

export interface InstalledPackage {
  name: string
  /** Version actually installed in node_modules, if resolvable */
  installed: string | null
  /** Range declared in the project's package.json */
  declared: string | null
  /** Deprecated per the `kick add` catalog */
  deprecated: boolean
}

/**
 * Collect every `@forinda/kickjs*` dependency the project declares,
 * pairing the declared range with the version actually installed in
 * `node_modules` (null when not installed — e.g. before the first
 * install, or a hoisted/virtual-store layout we can't see through).
 */
export function resolveInstalledKickPackages(projectDir: string): InstalledPackage[] {
  const manifestPath = join(projectDir, 'package.json')
  if (!existsSync(manifestPath)) return []
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return []
  }
  const declared: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }
  return Object.keys(declared)
    .filter((name) => name === '@forinda/kickjs' || name.startsWith('@forinda/kickjs-'))
    .toSorted()
    .map((name) => {
      let installed: string | null = null
      const installedManifest = join(projectDir, 'node_modules', ...name.split('/'), 'package.json')
      if (existsSync(installedManifest)) {
        try {
          installed = JSON.parse(readFileSync(installedManifest, 'utf-8')).version ?? null
        } catch {
          // unreadable — fall back to the declared range
        }
      }
      return {
        name,
        installed,
        declared: declared[name] ?? null,
        deprecated: DEPRECATED_PKGS.has(name),
      }
    })
}

/** Nearest ancestor directory (including `fromDir`) with a package.json. */
function findProjectRoot(fromDir: string): string | null {
  let dir = fromDir
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('Print system and framework info')
    .action(() => {
      const lines: string[] = [
        '',
        `  KickJS CLI v${ownVersion()}`,
        '',
        '  System:',
        `    OS:       ${platform()} ${release()} (${arch()})`,
        `    Node:     ${process.version}`,
      ]

      const projectRoot = findProjectRoot(process.cwd())
      const packages = projectRoot ? resolveInstalledKickPackages(projectRoot) : []

      if (!projectRoot) {
        lines.push('', '  Packages:  (not inside a project — no package.json found)')
      } else if (packages.length === 0) {
        lines.push('', `  Packages:  (no @forinda/kickjs* dependencies in ${projectRoot})`)
      } else {
        lines.push('', '  Packages:')
        const width = Math.max(...packages.map((p) => p.name.length))
        for (const pkg of packages) {
          const version = pkg.installed ?? `${pkg.declared ?? '?'} (declared — not installed)`
          const flag = pkg.deprecated ? '  [DEPRECATED — see `kick add --list --all`]' : ''
          lines.push(`    ${pkg.name.padEnd(width + 2)} ${version}${flag}`)
        }
      }

      lines.push('')
      console.log(lines.join('\n'))
    })
}
