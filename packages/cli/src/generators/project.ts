import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeFileSafe } from '../utils/fs'
import {
  generatePackageJson,
  generateViteConfig,
  generateTsConfig,
  generatePrettierConfig,
  generateEditorConfig,
  generateGitIgnore,
  generateGitAttributes,
  generateEnv,
  generateEnvExample,
  generateVitestConfig,
} from './templates/project-config'
import {
  generateEntryFile,
  generateEnvFile,
  generateModulesIndex,
  generateKickConfig,
  generateHelloService,
  generateHelloController,
  generateHelloModule,
} from './templates/project-app'
import { generateReadme, generateClaude, generateAgents } from './templates/project-docs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const KICKJS_VERSION = `^${cliPkg.version}`

type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

interface InitProjectOptions {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn'
  initGit?: boolean
  installDeps?: boolean
  template?: ProjectTemplate
  defaultRepo?: string
  packages?: string[]
}

/** Scaffold a new KickJS project */
export async function initProject(options: InitProjectOptions): Promise<void> {
  const {
    name,
    directory,
    packageManager = 'pnpm',
    template = 'rest',
    defaultRepo = 'inmemory',
    packages = [],
  } = options
  const dir = directory

  const log = (msg: string) => console.log(`  ${msg}`)

  console.log(`\n  Creating KickJS project: ${name}\n`)

  // ── package.json — template-aware deps ────────────────────────────
  await writeFileSafe(
    join(dir, 'package.json'),
    generatePackageJson(name, template, KICKJS_VERSION, packages),
  )

  // ── vite.config.ts — enables HMR + SWC for decorators ──────────────
  await writeFileSafe(join(dir, 'vite.config.ts'), generateViteConfig())

  // ── tsconfig.json ───────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'tsconfig.json'), generateTsConfig())

  // ── .prettierrc ─────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.prettierrc'), generatePrettierConfig())

  // ── .editorconfig ─────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.editorconfig'), generateEditorConfig())

  // ── .gitignore ──────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.gitignore'), generateGitIgnore())

  // ── .gitattributes ────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.gitattributes'), generateGitAttributes())

  // ── .env ────────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.env'), generateEnv())

  await writeFileSafe(join(dir, '.env.example'), generateEnvExample())

  // ── src/config/index.ts — typed env schema (read by `kick typegen`) ─
  // Lives under `src/config/` so the framework's "config" concept has a
  // single, conventional home. Old projects with `src/env.ts` still
  // work — `detectEnvFile()` searches both locations.
  await writeFileSafe(join(dir, 'src/config/index.ts'), generateEnvFile())

  // ── src/index.ts — template-aware entry point ─────────────────────
  await writeFileSafe(
    join(dir, 'src/index.ts'),
    generateEntryFile(name, template, cliPkg.version, packages),
  )

  // ── src/modules/index.ts ────────────────────────────────────────────
  await writeFileSafe(join(dir, 'src/modules/index.ts'), generateModulesIndex())

  // ── src/modules/hello/ — sample module ─────────────────────────────
  await writeFileSafe(join(dir, 'src/modules/hello/hello.service.ts'), generateHelloService())
  await writeFileSafe(join(dir, 'src/modules/hello/hello.controller.ts'), generateHelloController())
  await writeFileSafe(join(dir, 'src/modules/hello/hello.module.ts'), generateHelloModule())

  // ── Template-specific files ─────────────────────────────────────────
  if (template === 'graphql') {
    await writeFileSafe(join(dir, 'src/resolvers/.gitkeep'), '')
  }

  // ── kick.config.ts — CLI configuration ─────────────────────────────
  await writeFileSafe(join(dir, 'kick.config.ts'), generateKickConfig(template, defaultRepo))

  // ── vitest.config.ts ────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'vitest.config.ts'), generateVitestConfig())

  // ── README.md ────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'README.md'), generateReadme(name, template, packageManager))

  // ── CLAUDE.md ────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'CLAUDE.md'), generateClaude(name, template, packageManager))

  // ── AGENTS.md ────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'AGENTS.md'), generateAgents(name, template, packageManager))

  // ── Install Dependencies ────────────────────────────────────────────
  // Install BEFORE git init so the lockfile is included in the first commit.
  if (options.installDeps) {
    console.log(`\n  Installing dependencies with ${packageManager}...\n`)
    try {
      execSync(`${packageManager} install`, { cwd: dir, stdio: 'inherit' })
      console.log('\n  Dependencies installed successfully!')
    } catch {
      console.log(`\n  Warning: ${packageManager} install failed. Run it manually.`)
    }
  }

  // ── Initial typegen ────────────────────────────────────────────────
  // Run typegen once so the freshly-scaffolded HelloController's
  // `Ctx<KickRoutes.HelloController['index']>` references resolve in
  // the user's editor immediately. Failures are non-fatal.
  try {
    const { runTypegen } = await import('../typegen')
    await runTypegen({ cwd: dir, allowDuplicates: true, silent: true })
  } catch {
    // First-run typegen errors are non-fatal — `kick dev` will retry.
  }

  // ── Git Init ─────────────────────────────────────────────────────────
  // Runs after install + typegen so lockfile and generated types are
  // included in the initial commit.
  if (options.initGit) {
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' })
      execSync('git branch -M main', { cwd: dir, stdio: 'pipe' })
      execSync('git add -A', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "chore: initial commit from kick new"', {
        cwd: dir,
        stdio: 'pipe',
      })
      log('Git repository initialized')
    } catch {
      log('Warning: git init failed (git may not be installed)')
    }
  }

  console.log('\n  Project scaffolded successfully!')
  console.log()

  const needsCd = dir !== process.cwd()
  log('Next steps:')
  if (needsCd) log(`  cd ${name}`)
  if (!options.installDeps) log(`  ${packageManager} install`)

  const genHint: Record<string, string> = {
    rest: 'kick g module user',
    graphql: 'kick g resolver user',
    ddd: 'kick g module user --repo drizzle',
    cqrs: 'kick g module user --pattern cqrs',
    minimal: '# add your routes to src/index.ts',
  }
  log(`  ${genHint[template] ?? genHint.rest}`)
  log('  kick dev')
  log('')
  log('Commands:')
  log('  kick dev                  Start dev server with Vite HMR')
  log('  kick build                Production build via Vite')
  log('  kick start                Run production build')
  log('')
  log('Generators:')
  log('  kick g module <name>      Full DDD module (controller, DTOs, use-cases, repo)')
  log('  kick g scaffold <n> <f..> CRUD module from field definitions')
  log('  kick g controller <name>  Standalone controller')
  log('  kick g service <name>     @Service() class')
  log('  kick g middleware <name>   Express middleware')
  log('  kick g guard <name>       Route guard (auth, roles, etc.)')
  log('  kick g adapter <name>     AppAdapter with lifecycle hooks')
  log('  kick g dto <name>         Zod DTO schema')
  if (template === 'graphql') log('  kick g resolver <name>    GraphQL resolver')
  if (template === 'cqrs') log('  kick g job <name>         Queue job processor')
  log('  kick g config             Generate kick.config.ts')
  log('')
  log('Add packages:')
  log('  kick add <pkg>            Install a KickJS package + peers')
  log('  kick add --list           Show all available packages')
  log('')
  log('Available: auth, swagger, graphql, drizzle, prisma, ws,')
  log('           cron, queue, mailer, otel, multi-tenant, notifications, testing')
  log('')
}
