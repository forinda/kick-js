import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Command } from 'commander'
import { loadKickConfig, PACKAGE_MANAGERS, type PackageManager } from '../config'

interface PackageEntry {
  pkg: string
  peers: string[]
  description: string
  dev?: boolean
  /**
   * `true` for packages every project needs (framework + Vite plugin +
   * CLI). `kick new` installs these regardless of options chosen, and
   * future package-removal flows refuse to drop them.
   */
  core?: boolean
}

/** Registry of KickJS packages and their required peer dependencies */
const PACKAGE_REGISTRY: Record<string, PackageEntry> = {
  // Core (always installed by kick new — required for the framework to run)
  kickjs: {
    pkg: '@forinda/kickjs',
    peers: ['express'],
    description: 'Unified framework: DI, decorators, routing, middleware',
    core: true,
  },
  vite: {
    pkg: '@forinda/kickjs-vite',
    peers: ['vite'],
    description: 'Vite plugin: dev server, HMR, module discovery',
    dev: true,
    core: true,
  },
  cli: {
    pkg: '@forinda/kickjs-cli',
    peers: [],
    description: 'CLI tool and code generators',
    dev: true,
    core: true,
  },

  // Schema validation — the validator backing env + DTO + OpenAPI
  // schemas. `@forinda/kickjs-schema` (a core dep) wraps whichever one
  // you pick behind `KickSchema`, but the validator itself is an
  // optional peer of `@forinda/kickjs`, so it must be installed
  // explicitly or the app errors at startup ("Cannot find module
  // 'zod'"). `kick new` installs the chosen one; `kick add` lets an
  // existing project add/switch.
  zod: {
    pkg: 'zod',
    peers: [],
    description: 'Zod schema validation (env, DTOs, OpenAPI) — wrap with fromZod()',
  },
  valibot: {
    pkg: 'valibot',
    peers: [],
    description: 'Valibot schema validation — wrap with fromValibot()',
  },
  yup: {
    pkg: 'yup',
    peers: [],
    description: 'Yup schema validation — wrap with fromYup()',
  },

  // API
  swagger: {
    pkg: '@forinda/kickjs-swagger',
    peers: [],
    description: 'OpenAPI spec + Swagger UI + ReDoc',
  },
  // Database — the dialect adapters now ship as subpaths of
  // `@forinda/kickjs-db` (`/pg`, `/sqlite`, `/mysql`), so each `kick add`
  // pulls the core package plus the one driver you need.
  db: {
    pkg: '@forinda/kickjs-db',
    peers: [],
    description: 'kick/db core — schema DSL, migrations, KickDbClient, customType',
  },
  pg: {
    pkg: '@forinda/kickjs-db',
    peers: ['pg'],
    description: 'kick/db + PostgreSQL driver (use @forinda/kickjs-db/pg)',
  },
  sqlite: {
    pkg: '@forinda/kickjs-db',
    peers: ['better-sqlite3'],
    description: 'kick/db + SQLite driver (use @forinda/kickjs-db/sqlite)',
  },
  mysql: {
    pkg: '@forinda/kickjs-db',
    peers: ['mysql2'],
    description: 'kick/db + MySQL driver (use @forinda/kickjs-db/mysql)',
  },
  drizzle: {
    pkg: '@forinda/kickjs-drizzle',
    peers: ['drizzle-orm'],
    description: 'Drizzle ORM adapter + query builder',
  },
  prisma: {
    pkg: '@forinda/kickjs-prisma',
    peers: ['@prisma/client'],
    description: 'Prisma adapter + query builder',
  },

  // Real-time
  ws: {
    pkg: '@forinda/kickjs-ws',
    peers: ['socket.io'],
    description: 'WebSocket with @WsController decorators',
  },

  // DevTools
  devtools: {
    pkg: '@forinda/kickjs-devtools',
    peers: [],
    description: 'Development dashboard — routes, DI, metrics, health',
    dev: true,
  },

  // Queue
  queue: {
    pkg: '@forinda/kickjs-queue',
    peers: [],
    description: 'Queue adapter (BullMQ/RabbitMQ/Kafka)',
  },
  'queue:bullmq': {
    pkg: '@forinda/kickjs-queue',
    peers: ['bullmq', 'ioredis'],
    description: 'Queue with BullMQ + Redis',
  },
  'queue:rabbitmq': {
    pkg: '@forinda/kickjs-queue',
    peers: ['amqplib'],
    description: 'Queue with RabbitMQ',
  },
  'queue:kafka': {
    pkg: '@forinda/kickjs-queue',
    peers: ['kafkajs'],
    description: 'Queue with Kafka',
  },
  'queue:redis-pubsub': {
    pkg: '@forinda/kickjs-queue',
    peers: ['ioredis'],
    description: 'Lightweight pub/sub via Redis (no persistence)',
  },

  // MCP — Model Context Protocol server
  mcp: {
    pkg: '@forinda/kickjs-mcp',
    peers: ['@modelcontextprotocol/sdk'],
    description: 'Model Context Protocol server — expose @Controller endpoints as AI tools',
  },

  // Testing
  testing: {
    pkg: '@forinda/kickjs-testing',
    peers: [],
    description: 'Test utilities and TestModule builder',
    dev: true,
  },
}

/**
 * Walk up from `fromDir` to filesystem root, returning the first
 * directory that contains `name`. Lets monorepo sub-packages pick up
 * lockfiles and `packageManager` fields living at the workspace root.
 */
function findUp(name: string, fromDir = process.cwd()): string | null {
  let current = fromDir
  while (true) {
    if (existsSync(resolve(current, name))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function detectFromLockfile(): PackageManager | null {
  if (findUp('pnpm-lock.yaml')) return 'pnpm'
  if (findUp('yarn.lock')) return 'yarn'
  if (findUp('bun.lockb') || findUp('bun.lock')) return 'bun'
  if (findUp('package-lock.json')) return 'npm'
  return null
}

/**
 * Read `packageManager` from the nearest ancestor `package.json` that
 * declares the field (corepack convention: `"pnpm@10.0.0"`). Climbs so
 * monorepo sub-packages inherit the workspace pm even when their own
 * package.json omits the field.
 */
function packageManagerFromPackageJson(): PackageManager | null {
  let dir: string | null = process.cwd()
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
 * 4. Nearest ancestor lockfile (pnpm-lock.yaml → yarn.lock → bun.lock → package-lock.json)
 * 5. `'npm'` fallback
 *
 * Returns the chosen pm plus the source for callers that want to log
 * the resolution path.
 */
export async function resolvePackageManagerWithSource(
  flagPm: string | undefined,
): Promise<{ pm: PackageManager; source: PackageManagerSource }> {
  if (flagPm && PACKAGE_MANAGERS.includes(flagPm as PackageManager)) {
    return { pm: flagPm as PackageManager, source: 'flag' }
  }

  const config = await loadKickConfig(process.cwd())
  if (config?.packageManager && PACKAGE_MANAGERS.includes(config.packageManager)) {
    return { pm: config.packageManager, source: 'config' }
  }

  const fromPkg = packageManagerFromPackageJson()
  if (fromPkg) return { pm: fromPkg, source: 'package.json' }

  const fromLock = detectFromLockfile()
  if (fromLock) return { pm: fromLock, source: 'lockfile' }

  return { pm: 'npm', source: 'default' }
}

/** Convenience wrapper for callers that don't care about the source. */
export async function resolvePackageManager(flagPm: string | undefined): Promise<PackageManager> {
  const { pm } = await resolvePackageManagerWithSource(flagPm)
  return pm
}

/**
 * Print the package catalog. By default shows just the three core
 * packages every project always has — the optional list churns
 * (packages added, deprecated, removed) and a long enumeration in CLI
 * output / docs goes stale within a release. Pass `all = true` to dump
 * everything; that's what `kick add --list --all` triggers when an
 * adopter genuinely wants the live catalog.
 */
export function printPackageList(all = false): void {
  const entries = Object.entries(PACKAGE_REGISTRY)
  const maxName = Math.max(...entries.map(([k]) => k.length))
  const core = entries.filter(([, info]) => info.core)
  const optional = entries.filter(([, info]) => !info.core)

  const formatRow = ([name, info]: [string, PackageEntry]): string => {
    const padded = name.padEnd(maxName + 2)
    const peers = info.peers.length ? ` (+ ${info.peers.join(', ')})` : ''
    return `    ${padded} ${info.description}${peers}`
  }

  console.log('\n  Core packages (always installed by `kick new`):\n')
  for (const row of core) console.log(formatRow(row))

  if (all) {
    console.log('\n  Optional packages (add as needed):\n')
    for (const row of optional) console.log(formatRow(row))
  } else {
    console.log(`\n  Plus ${optional.length} optional packages (auth, swagger, db, queue, …).`)
    console.log('  Run `kick add --list --all` for the full catalog.')
  }

  console.log('\n  Usage: kick add auth drizzle swagger')
  console.log('         kick add queue:bullmq')
  console.log()
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List KickJS packages (core only; pair with --all for the full catalog)')
    .option('--all', 'Include the full optional catalog')
    .action((opts: { all?: boolean }) => {
      printPackageList(Boolean(opts.all))
    })
}

export function registerAddCommand(program: Command): void {
  program
    .command('add [packages...]')
    .description('Add KickJS packages with their required dependencies')
    .option('--pm <manager>', 'Package manager override')
    .option('-D, --dev', 'Install as dev dependency')
    .option('--list', 'List packages (core only by default; pair with --all)')
    .option('--all', 'When listing, include the full optional catalog')
    .action(async (packages: string[], opts: any) => {
      // List mode
      if (opts.list || packages.length === 0) {
        printPackageList(Boolean(opts.all))
        return
      }

      const { pm, source } = await resolvePackageManagerWithSource(opts.pm)
      console.log(`\n  Using ${pm} (resolved from ${source})`)
      const forceDevFlag = opts.dev
      const prodDeps = new Set<string>()
      const devDeps = new Set<string>()
      const unknown: string[] = []

      for (const name of packages) {
        const entry = PACKAGE_REGISTRY[name]
        if (!entry) {
          unknown.push(name)
          continue
        }
        const target = forceDevFlag || entry.dev ? devDeps : prodDeps
        target.add(entry.pkg)
        for (const peer of entry.peers) {
          target.add(peer)
        }
      }

      if (unknown.length > 0) {
        console.log(`\n  Unknown packages: ${unknown.join(', ')}`)
        console.log('  Run "kick add --list" to see available packages.\n')
        if (prodDeps.size === 0 && devDeps.size === 0) return
      }

      // Install production dependencies
      if (prodDeps.size > 0) {
        const deps = Array.from(prodDeps)
        const cmd = `${pm} add ${deps.join(' ')}`
        console.log(`\n  Installing ${deps.length} dependency(ies):`)
        for (const dep of deps) console.log(`    + ${dep}`)
        console.log()
        try {
          execSync(cmd, { stdio: 'inherit' })
        } catch {
          console.log(`\n  Installation failed. Run manually:\n    ${cmd}\n`)
        }
      }

      // Install dev dependencies
      if (devDeps.size > 0) {
        const deps = Array.from(devDeps)
        const cmd = `${pm} add -D ${deps.join(' ')}`
        console.log(`\n  Installing ${deps.length} dev dependency(ies):`)
        for (const dep of deps) console.log(`    + ${dep} (dev)`)
        console.log()
        try {
          execSync(cmd, { stdio: 'inherit' })
        } catch {
          console.log(`\n  Installation failed. Run manually:\n    ${cmd}\n`)
        }
      }

      console.log('  Done!\n')
    })
}
