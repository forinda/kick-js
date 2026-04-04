import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'

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
  config: { pkg: '@forinda/kickjs-config', peers: [], description: 'Zod-based env validation' },
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
  graphql: {
    pkg: '@forinda/kickjs-graphql',
    peers: ['graphql'],
    description: 'GraphQL resolvers + GraphiQL',
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

  // Observability
  otel: {
    pkg: '@forinda/kickjs-otel',
    peers: ['@opentelemetry/api'],
    description: 'OpenTelemetry tracing + metrics',
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

  // Mailer
  mailer: {
    pkg: '@forinda/kickjs-mailer',
    peers: ['nodemailer'],
    description: 'Email sending — SMTP, Resend, SES, or custom provider',
  },

  // Cron
  cron: {
    pkg: '@forinda/kickjs-cron',
    peers: ['croner'],
    description: 'Cron job scheduling (production-grade with croner)',
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

  // Multi-tenancy
  'multi-tenant': {
    pkg: '@forinda/kickjs-multi-tenant',
    peers: [],
    description: 'Tenant resolution middleware',
  },

  // Notifications
  notifications: {
    pkg: '@forinda/kickjs-notifications',
    peers: [],
    description: 'Multi-channel notifications — email, Slack, Discord, webhook',
  },

  // Testing
  testing: {
    pkg: '@forinda/kickjs-testing',
    peers: [],
    description: 'Test utilities and TestModule builder',
    dev: true,
  },
}

function detectPackageManager(): string {
  if (existsSync(resolve('pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve('yarn.lock'))) return 'yarn'
  return 'npm'
}

export function printPackageList(): void {
  console.log('\n  Available KickJS packages:\n')
  const maxName = Math.max(...Object.keys(PACKAGE_REGISTRY).map((k) => k.length))
  for (const [name, info] of Object.entries(PACKAGE_REGISTRY)) {
    const padded = name.padEnd(maxName + 2)
    const peers = info.peers.length ? ` (+ ${info.peers.join(', ')})` : ''
    console.log(`    ${padded} ${info.description}${peers}`)
  }
  console.log('\n  Usage: kick add graphql drizzle otel')
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

      const pm = opts.pm ?? detectPackageManager()
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
