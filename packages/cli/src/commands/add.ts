import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Command } from 'commander'
import { loadKickConfig, PACKAGE_MANAGERS, type PackageManager } from '../config'

/** Registry of KickJS packages and their required peer dependencies */
const PACKAGE_REGISTRY: Record<
  string,
  { pkg: string; peers: string[]; description: string; dev?: boolean }
> = {
  // Core (already installed by kick new)
  kickjs: {
    pkg: '@forinda/kickjs',
    peers: ['express'],
    description: 'Unified framework: DI, decorators, routing, middleware',
  },
  vite: {
    pkg: '@forinda/kickjs-vite',
    peers: ['vite'],
    description: 'Vite plugin: dev server, HMR, module discovery',
    dev: true,
  },
  config: {
    pkg: 'dotenv',
    peers: [],
    description: 'Optional .env file loader (kickjs ConfigService now ships in @forinda/kickjs)',
  },
  cli: {
    pkg: '@forinda/kickjs-cli',
    peers: [],
    description: 'CLI tool and code generators',
    dev: true,
  },

  // API
  swagger: {
    pkg: '@forinda/kickjs-swagger',
    peers: [],
    description: 'OpenAPI spec + Swagger UI + ReDoc',
  },
  // Database
  db: {
    pkg: '@forinda/kickjs-db',
    peers: [],
    description: 'kick/db core — schema DSL, migrations, KickDbClient, customType',
  },
  'db-pg': {
    pkg: '@forinda/kickjs-db-pg',
    peers: ['pg'],
    description: 'kick/db PostgreSQL dialect + adapter (pgDialect, pgAdapter)',
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

  // Auth
  auth: {
    pkg: '@forinda/kickjs-auth',
    peers: ['jsonwebtoken'],
    description: 'Authentication — JWT, API key, and custom strategies',
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

export function printPackageList(): void {
  console.log('\n  Available KickJS packages:\n')
  const maxName = Math.max(...Object.keys(PACKAGE_REGISTRY).map((k) => k.length))
  for (const [name, info] of Object.entries(PACKAGE_REGISTRY)) {
    const padded = name.padEnd(maxName + 2)
    const peers = info.peers.length ? ` (+ ${info.peers.join(', ')})` : ''
    console.log(`    ${padded} ${info.description}${peers}`)
  }
  console.log('\n  Usage: kick add auth drizzle swagger')
  console.log('         kick add queue:bullmq')
  console.log()
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List all available KickJS packages')
    .action(() => {
      printPackageList()
    })
}

export function registerAddCommand(program: Command): void {
  program
    .command('add [packages...]')
    .description('Add KickJS packages with their required dependencies')
    .option('--pm <manager>', 'Package manager override')
    .option('-D, --dev', 'Install as dev dependency')
    .option('--list', 'List all available packages')
    .action(async (packages: string[], opts: any) => {
      // List mode
      if (opts.list || packages.length === 0) {
        printPackageList()
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
