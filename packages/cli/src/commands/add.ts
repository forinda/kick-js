import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

const BYO_GUIDES: Record<string, { guide: string; url: string; upstream: string }> = {
  cron: {
    guide: 'Scheduled tasks',
    url: 'https://forinda.github.io/kick-js/guide/cron',
    upstream: 'croner',
  },
  mailer: {
    guide: 'Mailers',
    url: 'https://forinda.github.io/kick-js/guide/mailer',
    upstream: 'nodemailer (or Resend / SES SDK)',
  },
  otel: {
    guide: 'OpenTelemetry',
    url: 'https://forinda.github.io/kick-js/guide/otel',
    upstream: '@opentelemetry/sdk-node',
  },
  'multi-tenant': {
    guide: 'Multi-tenancy',
    url: 'https://forinda.github.io/kick-js/guide/multi-tenancy',
    upstream: 'defineHttpContextDecorator + getRequestValue (no extra dep)',
  },
  notifications: {
    guide: 'Notifications',
    url: 'https://forinda.github.io/kick-js/guide/notifications',
    upstream: 'your chosen backend (SMTP / Slack / Discord / webhook)',
  },
  graphql: {
    guide: 'GraphQL',
    url: 'https://forinda.github.io/kick-js/guide/graphql',
    upstream: 'graphql-http (or graphql-yoga / Apollo / Pothos)',
  },
}

function detectPackageManager(): PackageManager {
  if (existsSync(resolve('pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve('yarn.lock'))) return 'yarn'
  if (existsSync(resolve('bun.lockb')) || existsSync(resolve('bun.lock'))) return 'bun'
  return 'npm'
}

/** Read `packageManager` from package.json (corepack convention: "pnpm@10.0.0") */
function packageManagerFromPackageJson(): PackageManager | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
    const field: unknown = pkg.packageManager
    if (typeof field !== 'string') return null
    const name = field.split('@')[0] as PackageManager
    return PACKAGE_MANAGERS.includes(name) ? name : null
  } catch {
    return null
  }
}

/**
 * Resolve which package manager to use, in priority order:
 * 1. `--pm` CLI flag
 * 2. `packageManager` in kick.config
 * 3. `packageManager` in package.json (corepack)
 * 4. Lockfile detection
 * 5. `'npm'`
 */
export async function resolvePackageManager(flagPm: string | undefined): Promise<PackageManager> {
  if (flagPm && PACKAGE_MANAGERS.includes(flagPm as PackageManager)) {
    return flagPm as PackageManager
  }

  const config = await loadKickConfig(process.cwd())
  if (config?.packageManager && PACKAGE_MANAGERS.includes(config.packageManager)) {
    return config.packageManager
  }

  const fromPkg = packageManagerFromPackageJson()
  if (fromPkg) return fromPkg

  return detectPackageManager()
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

      const pm = await resolvePackageManager(opts.pm)
      const forceDevFlag = opts.dev
      const prodDeps = new Set<string>()
      const devDeps = new Set<string>()
      const unknown: string[] = []
      const byo: string[] = []

      for (const name of packages) {
        const entry = PACKAGE_REGISTRY[name]
        if (!entry) {
          if (BYO_GUIDES[name]) byo.push(name)
          else unknown.push(name)
          continue
        }
        const target = forceDevFlag || entry.dev ? devDeps : prodDeps
        target.add(entry.pkg)
        for (const peer of entry.peers) {
          target.add(peer)
        }
      }

      if (byo.length > 0) {
        console.log(`\n  ${byo.length} package(s) are BYO in v5 — no wrapper to install:`)
        for (const name of byo) {
          const hint = BYO_GUIDES[name]
          console.log(`    ${name.padEnd(14)} → ${hint.guide}: ${hint.url}`)
          console.log(`    ${' '.padEnd(14)}   upstream: ${hint.upstream}`)
        }
        console.log('\n  These used to be @forinda/kickjs-* wrappers. v5 ships them as guide-based')
        console.log('  recipes that wire the upstream library through defineAdapter /')
        console.log('  definePlugin directly — ~60 lines you own in src/adapters/.\n')
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
