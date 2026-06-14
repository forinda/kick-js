import { join, dirname } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
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
import { generateReadme } from './templates/project-docs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
const CLI_VERSION_FALLBACK = `^${cliPkg.version}`

/**
 * Sibling `@forinda/kickjs-*` packages whose versions are resolved
 * independently when scaffolding a new project. Each entry is queried
 * via `npm view <name> version`; failure falls back to the CLI's own
 * version (`CLI_VERSION_FALLBACK`).
 *
 * Per-package independent versioning landed with changesets — before
 * that, every sibling shipped in lockstep with the CLI so a single
 * pin was correct. Now `@forinda/kickjs@5.5.0` may pair with
 * `@forinda/kickjs-cli@5.4.2` and `@forinda/kickjs-swagger@5.3.1`;
 * pinning them all to the CLI's version under-installs adopters.
 */
const SIBLING_PACKAGES = [
  '@forinda/kickjs',
  '@forinda/kickjs-cli',
  '@forinda/kickjs-schema',
  '@forinda/kickjs-vite',
  '@forinda/kickjs-swagger',
  '@forinda/kickjs-ws',
  '@forinda/kickjs-queue',
  '@forinda/kickjs-devtools',
  '@forinda/kickjs-testing',
] as const

/**
 * Resolve the latest published version of every sibling package via
 * `npm view <name> version` (via execFileSync — no shell, no
 * injection vector). Each query has a short timeout; failures fall
 * back to the CLI's own version with a `^` prefix so the scaffold
 * stays usable offline.
 */
async function resolveSiblingVersions(): Promise<Record<string, string>> {
  const results = await Promise.all(
    SIBLING_PACKAGES.map(async (name) => {
      try {
        const out = execFileSync('npm', ['view', name, 'version'], {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .toString()
          .trim()
        if (out && /^\d+\.\d+\.\d+/.test(out)) {
          return [name, `^${out}`] as const
        }
      } catch {
        // Network failure / package not yet published / npm
        // unavailable. Fall back to CLI version below.
      }
      return [name, CLI_VERSION_FALLBACK] as const
    }),
  )
  return Object.fromEntries(results)
}

/**
 * Resolve the exact published version of a package at a given dist-tag
 * (`npm view <name>@<tag> version`). Returns `null` on any failure. Used
 * to pin `@forinda/kickjs` to the `alpha` channel when scaffolding a
 * Fastify / h3 app — the engine subpaths (`@forinda/kickjs/fastify`,
 * `/h3`) ship only on the alpha until the runtimes land in a stable
 * release, so the default `latest` resolution would install a kickjs
 * that doesn't export them (→ Vite "./h3 is not exported" at boot).
 * Prerelease versions are pinned exactly (no `^`) — a caret range over a
 * prerelease has surprising semver semantics.
 */
function resolveExactVersionAtTag(name: string, tag: string): string | null {
  try {
    const out = execFileSync('npm', ['view', `${name}@${tag}`, 'version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return out && /^\d+\.\d+\.\d+/.test(out) ? out : null
  } catch {
    return null
  }
}

/**
 * Whether the package at a given dist-tag exports a subpath (e.g. `./h3`).
 * Reads the `exports` map via `npm view <name>@<tag> exports --json`. Used to
 * gate the alpha-pin: if `latest` already ships the engine subpath, the runtime
 * has graduated to stable and we should NOT downgrade to an older alpha.
 * Returns `false` on any failure (missing field / network / unparseable) so the
 * caller treats "unknown" as "not present" and falls through to the alpha path.
 */
function tagExportsSubpath(name: string, tag: string, subpath: string): boolean {
  try {
    const out = execFileSync('npm', ['view', `${name}@${tag}`, 'exports', '--json'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    if (!out) return false
    const exportsMap = JSON.parse(out) as Record<string, unknown>
    return Object.prototype.hasOwnProperty.call(exportsMap, subpath)
  } catch {
    return false
  }
}

type ProjectTemplate = 'rest' | 'minimal'
type SchemaLib = 'zod' | 'valibot' | 'yup'

interface InitProjectOptions {
  name: string
  directory: string
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  initGit?: boolean
  installDeps?: boolean
  template?: ProjectTemplate
  defaultRepo?: string
  packages?: string[]
  /** Schema library to scaffold env / DTOs with. Defaults to `zod`. */
  schemaLib?: SchemaLib
  /** HTTP engine to scaffold. Defaults to `express`. */
  runtime?: 'express' | 'fastify' | 'h3'
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
    schemaLib = 'zod',
    runtime = 'express',
  } = options
  const dir = directory

  const log = (msg: string) => console.log(`  ${msg}`)

  console.log(`\n  Creating KickJS project: ${name}\n`)

  // Resolve published version of every sibling kickjs package in
  // parallel. Per-package independent versioning means
  // `@forinda/kickjs@5.5.0` may pair with `@forinda/kickjs-cli@5.4.2`
  // and `@forinda/kickjs-swagger@5.3.1`; pinning every dep to the
  // CLI's own version under-installs adopters whenever a sibling
  // bumps independently. `npm view` fallback keeps the scaffold
  // working offline.
  log('Resolving package versions...')
  const versions = await resolveSiblingVersions()

  // The Fastify / h3 runtime subpaths (`@forinda/kickjs/fastify`, `/h3`) ship
  // only on the `alpha` channel until the pluggable-runtimes work lands in a
  // stable release. If `latest` already exports the chosen engine's subpath,
  // the runtime has graduated — use the stable version `resolveSiblingVersions`
  // already picked. Otherwise pin `@forinda/kickjs` to the alpha, so the
  // scaffolded app actually has the subpath it imports (a stable kickjs without
  // it fails to boot under Vite: `"./h3" is not exported`). This gate is
  // self-retiring: once runtimes are stable, `latest` exports the subpath and
  // the alpha branch is never taken. Express needs no subpath, so it's exempt.
  if (runtime !== 'express') {
    const subpath = `./${runtime}` // './fastify' | './h3'
    if (tagExportsSubpath('@forinda/kickjs', 'latest', subpath)) {
      log(`Using @forinda/kickjs@latest (stable ships the ${runtime} runtime)`)
    } else {
      const alpha = resolveExactVersionAtTag('@forinda/kickjs', 'alpha')
      if (alpha) {
        versions['@forinda/kickjs'] = alpha
        log(`Using @forinda/kickjs@${alpha} (alpha channel — ${runtime} runtime not yet in stable)`)
      } else {
        log(
          `WARNING: could not resolve @forinda/kickjs@alpha — the ${runtime} runtime subpath ` +
            `may be missing. After install, run: ${packageManager} add @forinda/kickjs@alpha`,
        )
      }
    }
  }

  // ── package.json — template-aware deps ────────────────────────────
  await writeFileSafe(
    join(dir, 'package.json'),
    generatePackageJson(name, template, versions, packages, schemaLib, runtime),
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
  await writeFileSafe(join(dir, 'src/config/index.ts'), generateEnvFile(schemaLib))

  // ── src/index.ts — template-aware entry point ─────────────────────
  await writeFileSafe(
    join(dir, 'src/index.ts'),
    generateEntryFile(name, template, cliPkg.version, packages, runtime),
  )

  // ── src/modules/index.ts ────────────────────────────────────────────
  await writeFileSafe(join(dir, 'src/modules/index.ts'), generateModulesIndex())

  // ── src/modules/hello/ — sample module ─────────────────────────────
  await writeFileSafe(join(dir, 'src/modules/hello/hello.service.ts'), generateHelloService())
  await writeFileSafe(join(dir, 'src/modules/hello/hello.controller.ts'), generateHelloController())
  await writeFileSafe(join(dir, 'src/modules/hello/hello.module.ts'), generateHelloModule())

  // ── kick.config.ts — CLI configuration ─────────────────────────────
  await writeFileSafe(
    join(dir, 'kick.config.ts'),
    generateKickConfig(template, defaultRepo, packageManager, runtime),
  )

  // ── vitest.config.ts ────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'vitest.config.ts'), generateVitestConfig())

  // ── README.md ────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'README.md'), generateReadme(name, template, packageManager))

  // ── Agent docs ──────────────────────────────────────────────────────
  // Delegate to `generateAgentDocs()` so `kick new` emits the same
  // `.agents/` subfolder layout as `kick g agents -f`. Otherwise the
  // two paths drifted: kick new was writing the legacy flat layout
  // (root-level AGENTS.md + kickjs-skills.md) while kick g agents
  // emits the per-skill SKILL.md format under .agents/. `force: true`
  // because the project directory is fresh — no overwrite prompts
  // make sense during init.
  const { generateAgentDocs } = await import('./agent-docs')
  await generateAgentDocs({
    outDir: dir,
    name,
    pm: packageManager,
    template,
    only: 'all',
    force: true,
  })

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
  log('  kick g config             Generate kick.config.ts')
  log('')
  log('Add packages:')
  log('  kick add <pkg>            Install a KickJS package + peers')
  log('  kick add --list           Show all available packages')
  log('')
  log('Available: auth, swagger, drizzle, prisma, ws, queue, devtools, mcp, testing')
  log('')
}
