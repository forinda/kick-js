import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeFileSafe } from '../utils/fs'
import { captureCommand, captureCommandAsync } from '../utils/shell'
import {
  generatePackageJson,
  generateViteConfig,
  generateTsConfig,
  generateFormatterConfig,
  generateEditorConfig,
  generateGitIgnore,
  generateGitAttributes,
  generateEnv,
  generateEnvExample,
  generateEnvTest,
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
import { AVAILABLE_ADD_PACKAGES } from '../commands/add'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * The CLI's own package.json sits one level up from the bundle
 * (`dist/project-*.mjs`) but two levels up from this source file
 * (`src/generators/project.ts`). Checking both is what lets this module be
 * imported from a test at all — reading only the bundle-relative path threw
 * ENOENT the moment anything imported it from source, which is why the
 * version-resolution path shipped untested.
 */
const cliPkg = JSON.parse(
  readFileSync(
    [join(__dirname, '..', 'package.json'), join(__dirname, '..', '..', 'package.json')].find(
      existsSync,
    )!,
    'utf-8',
  ),
)

/**
 * Sibling `@forinda/kickjs-*` packages whose versions are resolved
 * independently when scaffolding a new project. Each entry is queried
 * via `npm view <name> version`; failure falls back to `latest`
 * (see `fallbackRange`).
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
  '@forinda/kickjs-client',
] as const

/**
 * Range to write when `npm view <name> version` gives us nothing.
 *
 * It must never be the CLI's own version. Sibling packages version
 * independently, so `@forinda/kickjs-vite@^${cliVersion}` names a release
 * that does not exist — the scaffold then dies at install time with
 * `npm error 404 '@forinda/kickjs-vite@^6.14.1' is not in this registry`,
 * which is worse than the under-install this fallback was meant to avoid.
 * `latest` is the one range that is always resolvable and always current.
 *
 * The CLI itself is the exception: its version IS the CLI's version, and
 * pinning it keeps a scaffold reproducible against the CLI that made it.
 */
function fallbackRange(name: string): string {
  return name === '@forinda/kickjs-cli' ? `^${cliPkg.version}` : 'latest'
}

/**
 * Resolve the latest published version of every sibling package via
 * `npm view <name> version` (through `captureCommandAsync`, which routes
 * around Windows' `.cmd` shims — see utils/shell.ts).
 *
 * The timeout is generous and the queries are genuinely concurrent: a
 * warm `npm view` against the public registry measures 0.6–3.6s per
 * package, so the old 5s budget was one slow response away from expiring,
 * and the sync `captureCommand` under `Promise.all` ran all ten serially
 * — making the per-call budget the only thing standing between a scaffold
 * and a package.json full of fallbacks.
 */
export async function resolveSiblingVersions(): Promise<Record<string, string>> {
  const results = await Promise.all(
    SIBLING_PACKAGES.map(async (name) => {
      // Network failure / package not yet published / npm unavailable
      // all surface as null → fall back to a range that always resolves.
      const out = await captureCommandAsync('npm', ['view', name, 'version'], { timeout: 20_000 })
      if (out && /^\d+\.\d+\.\d+/.test(out)) {
        return [name, `^${out}`] as const
      }
      return [name, fallbackRange(name)] as const
    }),
  )
  return Object.fromEntries(results)
}

/**
 * Resolve the published version of a package at a given dist-tag
 * (`npm view <name>@<tag> version`). Returns `null` on any failure. Used
 * to pin `@forinda/kickjs` to the `alpha` channel when scaffolding a
 * Fastify / h3 app — the engine subpaths (`@forinda/kickjs/fastify`,
 * `/h3`) ship only on the alpha until the runtimes land in a stable
 * release, so the default `latest` resolution would install a kickjs
 * that doesn't export them (→ Vite "./h3 is not exported" at boot).
 * Returns the bare version; the caller applies a `^` range so the project
 * floats to newer alphas and auto-graduates to stable (a caret over a
 * prerelease matches same-tuple prereleases ≥ it, plus later stables `< next
 * major`).
 */
function resolveVersionAtTag(name: string, tag: string): string | null {
  const out = captureCommand('npm', ['view', `${name}@${tag}`, 'version'], { timeout: 20_000 })
  return out && /^\d+\.\d+\.\d+/.test(out) ? out : null
}

/**
 * Whether the package at a given dist-tag exports a subpath (e.g. `./h3`).
 * Reads the `exports` map via `npm view <name>@<tag> exports --json`. Used to
 * gate the alpha-pin: if `latest` already ships the engine subpath, the runtime
 * has graduated to stable and we should NOT downgrade to an older alpha.
 * Returns `false` on any failure (missing field / network / unparseable) so the
 * caller treats "unknown" as "not present" and falls through to the alpha path.
 */
/** Strip a leading range operator (`^1.2.3` / `~1.2.3` → `1.2.3`). */
function stripRange(range: string | undefined): string {
  return (range ?? '').replace(/^[\^~>=<\s]+/, '')
}

/**
 * Compare the release cores (major.minor.patch, ignoring any `-prerelease`
 * suffix) of two versions: is `a` >= `b`? Used to guard the alpha-pin so a
 * package is never downgraded onto a stale prerelease whose stable line has
 * already moved past it. A coarse compare is enough here — we only need
 * "is this alpha at least as new as the stable we'd otherwise install".
 */
function baseVersionGte(a: string, b: string): boolean {
  const core = (v: string): number[] =>
    stripRange(v)
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const [a0 = 0, a1 = 0, a2 = 0] = core(a)
  const [b0 = 0, b1 = 0, b2 = 0] = core(b)
  if (a0 !== b0) return a0 > b0
  if (a1 !== b1) return a1 > b1
  return a2 >= b2
}

function tagExportsSubpath(name: string, tag: string, subpath: string): boolean {
  const out = captureCommand('npm', ['view', `${name}@${tag}`, 'exports', '--json'], {
    timeout: 20_000,
  })
  if (!out) return false
  try {
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
  /** Wire `SpaAdapter` at this clientDir (fullstack template). */
  spaClientDir?: string
  /** Pin the compiler API + generate the client route map (fullstack). */
  withClientMap?: boolean
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

  // A 'latest' range means the registry query failed for that package. The
  // install still works, but the pin is looser than intended and the user
  // should know why their package.json does not read like the docs.
  const unresolved = Object.keys(versions).filter((name) => versions[name] === 'latest')
  if (unresolved.length > 0) {
    log(`WARNING: could not reach npm for ${unresolved.join(', ')} — pinned to 'latest'`)
  }

  // The pluggable-runtimes work (Fastify / h3 engine subpaths, the
  // `kick/runtime` typegen, `kick add upload`, `kick doctor` runtime checks)
  // ships only on the `alpha` channel until it lands in a stable release. So a
  // non-Express scaffold needs the alpha of every package that carries runtime
  // behavior, not just `@forinda/kickjs`:
  //   - `@forinda/kickjs`       — the `./fastify` / `./h3` export subpaths the
  //                               app imports (stable lacks them → Vite boot
  //                               error `"./h3" is not exported`).
  //   - `@forinda/kickjs-cli`   — `--runtime`, `kick add upload`, `kick doctor`,
  //                               the `kick/runtime` typegen plugin.
  //   - `@forinda/kickjs-vite`  — the dev loop co-versioned with the above.
  // Gated on whether `@forinda/kickjs@latest` already exports the chosen engine
  // subpath: once that's true the runtimes are stable and we keep `latest` for
  // everything (self-retiring — no code change needed at graduation). Each pin
  // is guarded so it never DOWNGRADES (an alpha can be older than latest — e.g.
  // a package whose stable moved on past an old prerelease). Express is exempt.
  if (runtime !== 'express') {
    const subpath = `./${runtime}` // './fastify' | './h3'
    if (tagExportsSubpath('@forinda/kickjs', 'latest', subpath)) {
      log(`Using @forinda/kickjs@latest (stable ships the ${runtime} runtime)`)
    } else {
      const RUNTIME_PKGS = ['@forinda/kickjs', '@forinda/kickjs-cli', '@forinda/kickjs-vite']
      const pinned: string[] = []
      let kickjsPinned = false
      for (const pkg of RUNTIME_PKGS) {
        const alpha = resolveVersionAtTag(pkg, 'alpha')
        // Only switch when the alpha is newer-or-equal to the stable we'd
        // otherwise install — never downgrade onto a stale prerelease. Use a
        // `^` range (not an exact pin) so the project picks up newer alphas and
        // auto-graduates to the stable release once it ships.
        if (alpha && baseVersionGte(alpha, stripRange(versions[pkg]))) {
          versions[pkg] = `^${alpha}`
          pinned.push(`${pkg}@^${alpha}`)
          if (pkg === '@forinda/kickjs') kickjsPinned = true
        }
      }
      if (kickjsPinned) {
        log(`Using the alpha channel for the ${runtime} runtime: ${pinned.join(', ')}`)
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
    generatePackageJson(
      name,
      template,
      versions,
      packages,
      schemaLib,
      runtime,
      options.withClientMap,
    ),
  )

  // ── vite.config.ts — enables HMR + SWC for decorators ──────────────
  await writeFileSafe(join(dir, 'vite.config.ts'), generateViteConfig())

  // ── tsconfig.json ───────────────────────────────────────────────────
  await writeFileSafe(join(dir, 'tsconfig.json'), generateTsConfig())

  // ── .oxfmtrc.json ───────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.oxfmtrc.json'), generateFormatterConfig())

  // ── .editorconfig ─────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.editorconfig'), generateEditorConfig())

  // ── .gitignore ──────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.gitignore'), generateGitIgnore())

  // ── .gitattributes ────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.gitattributes'), generateGitAttributes())

  // ── .env ────────────────────────────────────────────────────────────
  await writeFileSafe(join(dir, '.env'), generateEnv())

  await writeFileSafe(join(dir, '.env.example'), generateEnvExample())

  // `.env.test` is read INSTEAD of `.env` under a test run, so scaffolding
  // it is what makes a new project isolated by default. Without it the
  // generated app ships the exact shape `kick doctor` warns about — a
  // `.env` plus a test runner — and its first test run prints the backfill
  // warning rather than being isolated.
  await writeFileSafe(join(dir, '.env.test'), generateEnvTest())

  // ── src/config/index.ts — typed env schema (read by `kick typegen`) ─
  // Lives under `src/config/` so the framework's "config" concept has a
  // single, conventional home. Old projects with `src/env.ts` still
  // work — `detectEnvFile()` searches both locations.
  await writeFileSafe(join(dir, 'src/config/index.ts'), generateEnvFile(schemaLib))

  // ── src/index.ts — template-aware entry point ─────────────────────
  await writeFileSafe(
    join(dir, 'src/index.ts'),
    generateEntryFile(name, template, cliPkg.version, packages, runtime, options.spaClientDir),
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
  log(`Available: ${AVAILABLE_ADD_PACKAGES}`)
  log('')
}
