import { resolve, basename } from 'node:path'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import type { Command } from 'commander'
import { initProject } from '../generators/project'
import { intro, outro, text, select, multiSelect, confirm, log } from '../utils/prompts'
import { colors } from '../utils/colors'

/** All optional packages available for selection */
const OPTIONAL_PACKAGES = [
  { value: 'auth', label: 'Auth', hint: 'JWT, OAuth, API keys' },
  { value: 'swagger', label: 'Swagger', hint: 'OpenAPI docs' },
  { value: 'otel', label: 'OpenTelemetry', hint: 'tracing & metrics' },
  { value: 'ws', label: 'WebSocket', hint: 'rooms, heartbeat' },
  { value: 'queue', label: 'Queue', hint: 'BullMQ/RabbitMQ/Kafka' },
  { value: 'cron', label: 'Cron', hint: 'scheduled jobs' },
  { value: 'mailer', label: 'Mailer', hint: 'SMTP, Resend, SES' },
  { value: 'graphql', label: 'GraphQL', hint: 'resolvers, GraphiQL' },
  { value: 'devtools', label: 'DevTools', hint: 'debug dashboard' },
  { value: 'notifications', label: 'Notifications', hint: 'email, Slack, Discord' },
  { value: 'multi-tenant', label: 'Multi-Tenant', hint: 'tenant resolution' },
] as const

export function registerInitCommand(program: Command): void {
  program
    .command('new [name]')
    .alias('init')
    .description('Create a new KickJS project (use "." for current directory)')
    .option('-d, --directory <dir>', 'Target directory (defaults to project name)')
    .option('--pm <manager>', 'Package manager: pnpm | npm | yarn')
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--install', 'Install dependencies after scaffolding')
    .option('--no-install', 'Skip dependency installation')
    .option('-f, --force', 'Remove existing files without prompting')
    .option('-t, --template <type>', 'Project template: rest | graphql | ddd | cqrs | minimal')
    .option('-r, --repo <type>', 'Default repository: prisma | drizzle | inmemory | custom')
    .option('--packages <packages>', 'Comma-separated packages to include (e.g. auth,swagger,otel)')
    .action(async (name: string | undefined, opts: any) => {
      intro('KickJS — Create a new project')

      // ── Project name ──────────────────────────────────────────────
      if (!name) {
        name = await text({
          message: 'Project name',
          placeholder: 'my-api',
          defaultValue: 'my-api',
        })
      }

      let directory: string
      if (name === '.') {
        directory = resolve('.')
        name = basename(directory)
      } else {
        directory = resolve(opts.directory || name)
      }

      // ── Check existing directory ──────────────────────────────────
      if (existsSync(directory)) {
        const entries = readdirSync(directory)
        if (entries.length > 0) {
          if (opts.force) {
            log.warn(`Clearing existing files in ${directory}`)
          } else {
            log.warn(`Directory "${name}" is not empty:`)
            const shown = entries.slice(0, 5)
            for (const entry of shown) {
              log.message(`  - ${entry}`)
            }
            if (entries.length > 5) {
              log.message(`  ... and ${entries.length - 5} more`)
            }
            const shouldClear = await confirm({
              message: colors.red('Remove all existing files and proceed?'),
              initialValue: false,
            })
            if (!shouldClear) {
              outro('Aborted.')
              return
            }
          }
          for (const entry of entries) {
            rmSync(resolve(directory, entry), { recursive: true, force: true })
          }
        }
      }

      // ── Template ──────────────────────────────────────────────────
      let template = opts.template
      if (!template) {
        template = await select({
          message: 'Project template',
          options: [
            { value: 'rest', label: 'REST API', hint: 'Express + Swagger' },
            { value: 'graphql', label: 'GraphQL API', hint: 'GraphQL + GraphiQL' },
            { value: 'ddd', label: 'DDD', hint: 'Domain-Driven Design modules' },
            { value: 'cqrs', label: 'CQRS', hint: 'Commands, Queries, Events + WS/Queue' },
            { value: 'minimal', label: 'Minimal', hint: 'bare Express' },
          ],
        })
      }

      // ── Package manager ───────────────────────────────────────────
      let packageManager = opts.pm
      if (!packageManager) {
        packageManager = await select({
          message: 'Package manager',
          options: [
            { value: 'pnpm', label: 'pnpm' },
            { value: 'npm', label: 'npm' },
            { value: 'yarn', label: 'yarn' },
          ],
        })
      }

      // ── Repository type ───────────────────────────────────────────
      let defaultRepo = opts.repo
      if (!defaultRepo) {
        defaultRepo = await select({
          message: 'Default repository/ORM',
          options: [
            { value: 'prisma', label: 'Prisma' },
            { value: 'drizzle', label: 'Drizzle' },
            { value: 'inmemory', label: 'In-Memory' },
            { value: 'custom', label: 'Custom', hint: 'specify later' },
          ],
        })

        if (defaultRepo === 'custom') {
          defaultRepo = await text({
            message: 'Custom repository name',
            defaultValue: 'custom',
          })
        }
      }

      // ── Optional packages ─────────────────────────────────────────
      let selectedPackages: string[]
      if (opts.packages) {
        selectedPackages = opts.packages.split(',').map((p: string) => p.trim())
      } else {
        selectedPackages = await multiSelect({
          message: 'Select packages to include',
          options: [...OPTIONAL_PACKAGES],
          required: false,
        })
      }

      // ── Git init ──────────────────────────────────────────────────
      let initGit: boolean
      if (opts.git === undefined) {
        initGit = await confirm({
          message: 'Initialize git repository?',
          initialValue: true,
        })
      } else {
        initGit = opts.git
      }

      // ── Install deps ──────────────────────────────────────────────
      let installDeps: boolean
      if (opts.install === undefined) {
        installDeps = await confirm({
          message: 'Install dependencies?',
          initialValue: true,
        })
      } else {
        installDeps = opts.install
      }

      // ── Scaffold ──────────────────────────────────────────────────
      await initProject({
        name,
        directory,
        packageManager,
        initGit,
        installDeps,
        template,
        defaultRepo,
        packages: selectedPackages,
      })

      outro(`Done! Next steps: ${colors.cyan(`cd ${name} && ${packageManager} dev`)}`)
    })
}
