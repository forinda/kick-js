import { resolve } from 'node:path'
import type { Command } from 'commander'
import { listPluginGenerators, tryDispatchPluginGenerator } from '../generator-extension'
import { generateModule } from '../generators/module'
import { resolveRepoType, type RepoType } from '../generators/module'
import { generateAdapter } from '../generators/adapter'
import { generatePlugin } from '../generators/plugin'
import { generateMiddleware } from '../generators/middleware'
import { generateGuard } from '../generators/guard'
import { generateService } from '../generators/service'
import { generateController } from '../generators/controller'
import { generateDto } from '../generators/dto'
import { generateConfig } from '../generators/config'
import { generateAuthScaffold } from '../generators/auth-scaffold'
import { generateResolver } from '../generators/resolver'
import { generateJob } from '../generators/job'
import { generateScaffold, parseFields } from '../generators/scaffold'
import { generateTest } from '../generators/test'
import { loadKickConfig, resolveModuleConfig, type ProjectPattern } from '../config'
import { setDryRun } from '../utils/fs'
import { runTypegen } from '../typegen'
import { select, confirm as promptConfirm } from '../utils/prompts'

/** Options accepted by `kick g module` and the bare `kick g <name>` shortcut. */
interface ModuleGenOpts {
  entity?: boolean
  tests?: boolean
  repo?: RepoType
  pattern?: ProjectPattern
  minimal?: boolean
  modulesDir?: string
  pluralize?: boolean
  force?: boolean
}

/** Options on the parent `generate` command — module flags + global flags. */
interface GenerateRootOpts extends ModuleGenOpts {
  list?: boolean
  dryRun?: boolean
}

/** Generators that drop a single file at a configurable directory. */
interface OutDirOpts {
  out: string
}

/** Generators that scope output into a module folder. */
interface ModuleScopedOpts {
  out?: string
  module?: string
}

interface JobOpts extends OutDirOpts {
  queue?: string
}

interface ScaffoldOpts {
  entity?: boolean
  tests?: boolean
  pluralize?: boolean
  modulesDir?: string
}

interface AuthScaffoldOpts {
  strategy?: 'jwt' | 'session'
  roleGuards?: boolean
  out: string
}

interface ConfigOpts {
  modulesDir: string
  repo: string
  force?: boolean
}

/** Check if --dry-run was passed on the parent generate command */
function isDryRun(cmd: Command): boolean {
  return (cmd.parent?.opts() as { dryRun?: boolean } | undefined)?.dryRun ?? false
}

function printGenerated(files: string[], dryRun = false): void {
  const cwd = process.cwd()
  const label = dryRun ? 'Would generate' : 'Generated'
  console.log(`\n  ${label} ${files.length} file${files.length === 1 ? '' : 's'}:`)
  for (const f of files) {
    console.log(`    ${f.replace(cwd + '/', '')}`)
  }
  if (dryRun) console.log('\n  (dry run — no files were written)')
  console.log()
}

/**
 * Refresh `.kickjs/types/*` after a generator that emitted controllers,
 * so the new `Ctx<KickRoutes.X['method']>` references resolve in the
 * user's editor without waiting for `kick dev`.
 *
 * Loads `kick.config.ts` for `typegen.schemaValidator`. Failures are
 * non-fatal — typegen problems should never block code generation.
 */
async function runPostTypegen(dryRun: boolean): Promise<void> {
  if (dryRun) return
  try {
    const cfg = await loadKickConfig(process.cwd())
    await runTypegen({
      cwd: process.cwd(),
      allowDuplicates: true,
      silent: true,
      schemaValidator: cfg?.typegen?.schemaValidator ?? 'zod',
      envFile: cfg?.typegen?.envFile,
      srcDir: cfg?.typegen?.srcDir,
      outDir: cfg?.typegen?.outDir,
    })
  } catch {
    // Typegen failures are surfaced when the user runs `kick typegen`
    // explicitly. Don't block scaffolding on a regex bug.
  }
}

const GENERATORS = [
  { name: 'module <name>', description: 'Full DDD module (controller, DTOs, use-cases, repo)' },
  { name: 'scaffold <name> <fields...>', description: 'CRUD module from field definitions' },
  { name: 'controller <name>', description: '@Controller() class            [-m module]' },
  { name: 'service <name>', description: '@Service() singleton             [-m module]' },
  { name: 'middleware <name>', description: 'Express middleware function     [-m module]' },
  { name: 'guard <name>', description: 'Route guard (auth, roles, etc.)  [-m module]' },
  { name: 'dto <name>', description: 'Zod DTO schema                  [-m module]' },
  { name: 'adapter <name>', description: 'AppAdapter with lifecycle hooks (app-level only)' },
  { name: 'test <name>', description: 'Vitest test scaffold            [-m module]' },
  { name: 'resolver <name>', description: 'GraphQL @Resolver class' },
  { name: 'job <name>', description: 'Queue @Job processor' },
  { name: 'config', description: 'Generate kick.config.ts' },
]

async function printGeneratorList(): Promise<void> {
  console.log('\n  Built-in generators:\n')
  const maxName = Math.max(...GENERATORS.map((g) => g.name.length))
  for (const g of GENERATORS) {
    console.log(`    kick g ${g.name.padEnd(maxName + 2)} ${g.description}`)
  }

  // Surface plugin-shipped generators alongside the built-ins so adopters
  // can discover what's available without grepping their node_modules.
  const discovery = await listPluginGenerators(process.cwd())
  if (discovery.generators.length > 0) {
    console.log('\n  Plugin generators:\n')
    const pluginMax = Math.max(...discovery.generators.map((g) => `${g.spec.name} <name>`.length))
    for (const { source, spec } of discovery.generators) {
      const usage = `${spec.name} <name>`
      console.log(`    kick g ${usage.padEnd(pluginMax + 2)} ${spec.description}  [${source}]`)
    }
  }

  if (discovery.failed.length > 0) {
    console.log('\n  Failed to load:\n')
    for (const { source, reason } of discovery.failed) {
      console.log(`    ${source} — ${reason}`)
    }
  }

  console.log()
}

/**
 * Generate one or more modules. Shared by `kick g module <names...>` and
 * the bare `kick g <names...>` shortcut.
 */
async function runModuleGeneration(
  names: string[],
  opts: ModuleGenOpts,
  dryRun: boolean,
): Promise<void> {
  const config = await loadKickConfig(process.cwd())
  const mc = resolveModuleConfig(config)
  const modulesDir = opts.modulesDir ?? mc.dir ?? 'src/modules'
  const repo: RepoType = opts.repo ?? resolveRepoType(mc.repo)
  const pattern = opts.pattern ?? config?.pattern ?? 'ddd'
  const shouldPluralize = opts.pluralize === false ? false : (mc.pluralize ?? true)

  const allFiles: string[] = []
  for (const name of names) {
    const files = await generateModule({
      name,
      modulesDir: resolve(modulesDir),
      noEntity: opts.entity === false,
      noTests: opts.tests === false,
      repo,
      minimal: opts.minimal,
      force: opts.force,
      pattern,
      dryRun,
      pluralize: shouldPluralize,
      prismaClientPath: mc.prismaClientPath,
    })
    allFiles.push(...files)
  }
  printGenerated(allFiles, dryRun)
  await runPostTypegen(dryRun)
}

export function registerGenerateCommand(program: Command): void {
  const gen = program
    .command('generate [names...]')
    .alias('g')
    .description(
      'Generate code scaffolds — bare form `kick g <name>` is shorthand for `kick g module <name>`',
    )
    .option('--list', 'List all available generators')
    .option('--dry-run', 'Preview files that would be generated without writing them')
    .option('--no-entity', 'Skip entity and value object generation (module shortcut)')
    .option('--no-tests', 'Skip test file generation (module shortcut)')
    .option('--repo <type>', 'Repository implementation: inmemory | drizzle | prisma')
    .option('--pattern <pattern>', 'Override project pattern: rest | ddd | cqrs | minimal')
    .option('--minimal', 'Shorthand for --pattern minimal')
    .option('--modules-dir <dir>', 'Modules directory')
    .option('--no-pluralize', 'Use singular names (skip auto-pluralization)')
    .option('-f, --force', 'Overwrite existing files without prompting')
    .action(async (names: string[], opts: GenerateRootOpts, cmd: Command) => {
      if (opts.list) {
        await printGeneratorList()
        return
      }
      if (!names || names.length === 0) {
        gen.help()
        return
      }
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)

      // Try plugin generators first — `kick g <name> <itemName>` where
      // `<name>` matches a discovered plugin generator wins over the
      // bare-module shortcut. This lets `kick g command Order` route
      // to a CQRS plugin without colliding with `kick g <module-name>`.
      if (names.length >= 2) {
        const [generatorName, itemName, ...rest] = names
        const result = await tryDispatchPluginGenerator({
          generatorName,
          itemName,
          args: rest,
          flags: opts as unknown as Record<string, string | boolean>,
          cwd: process.cwd(),
        })
        if (result) {
          printGenerated(result.files, dryRun)
          return
        }
      }

      await runModuleGeneration(names, opts, dryRun)
    })

  // ── kick g module <name> ────────────────────────────────────────────
  gen
    .command('module <names...>')
    .description('Generate one or more modules (e.g. kick g module user task project)')
    .option('--no-entity', 'Skip entity and value object generation')
    .option('--no-tests', 'Skip test file generation')
    .option('--repo <type>', 'Repository implementation: inmemory | drizzle | prisma')
    .option('--pattern <pattern>', 'Override project pattern: rest | ddd | cqrs | minimal')
    .option('--minimal', 'Shorthand for --pattern minimal')
    .option('--modules-dir <dir>', 'Modules directory')
    .option('--no-pluralize', 'Use singular names (skip auto-pluralization)')
    .option('-f, --force', 'Overwrite existing files without prompting')
    .action(async (names: string[], opts: ModuleGenOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      await runModuleGeneration(names, opts, dryRun)
    })

  // ── kick g adapter <name> ──────────────────────────────────────────
  gen
    .command('adapter <name>')
    .description('Generate an AppAdapter with lifecycle hooks and middleware support')
    .option('-o, --out <dir>', 'Output directory', 'src/adapters')
    .action(async (name: string, opts: OutDirOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generateAdapter({ name, outDir: resolve(opts.out) })
      printGenerated(files, dryRun)
    })

  // ── kick g plugin <name> ────────────────────────────────────────────
  gen
    .command('plugin <name>')
    .description(
      'Generate a KickPlugin with DI, modules, adapters, middleware, and lifecycle hooks',
    )
    .option('-o, --out <dir>', 'Output directory', 'src/plugins')
    .action(async (name: string, opts: OutDirOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generatePlugin({ name, outDir: resolve(opts.out) })
      printGenerated(files, dryRun)
    })

  // ── kick g middleware <name> ────────────────────────────────────────
  gen
    .command('middleware <name>')
    .description(
      'Generate an Express middleware function\n' +
        '  Use -m to scope it to a module: kick g middleware auth -m users',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', 'Place inside a module folder')
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateMiddleware({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g guard <name> ────────────────────────────────────────────
  gen
    .command('guard <name>')
    .description(
      'Generate a route guard (auth, roles, etc.)\n' +
        '  Use -m to scope it to a module: kick g guard admin -m users',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', 'Place inside a module folder')
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateGuard({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g service <name> ──────────────────────────────────────────
  gen
    .command('service <name>')
    .description(
      'Generate a @Service() class\n' +
        '  Use -m to scope it to a module: kick g service payment -m orders',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', 'Place inside a module folder')
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateService({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g controller <name> ───────────────────────────────────────
  gen
    .command('controller <name>')
    .description(
      'Generate a @Controller() class with basic routes\n' +
        '  Use -m to scope it to a module: kick g controller auth -m users',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', 'Place inside a module folder')
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateController({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
      await runPostTypegen(dryRun)
    })

  // ── kick g dto <name> ──────────────────────────────────────────────
  gen
    .command('dto <name>')
    .description(
      'Generate a Zod DTO schema\n' +
        '  Use -m to scope it to a module: kick g dto create-user -m users',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', 'Place inside a module folder')
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateDto({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g test <name> ────────────────────────────────────────────────
  gen
    .command('test <name>')
    .description(
      'Generate a Vitest test scaffold\n' +
        '  Use -m to scope it to a module: kick g test user-service -m users',
    )
    .option('-o, --out <dir>', 'Output directory (overrides --module)')
    .option('-m, --module <module>', "Place inside a module's __tests__/ folder")
    .action(async (name: string, opts: ModuleScopedOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = mc.dir ?? 'src/modules'
      const files = await generateTest({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pluralize: mc.pluralize ?? true,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g resolver <name> ────────────────────────────────────────────
  gen
    .command('resolver <name>')
    .description('Generate a GraphQL @Resolver class with @Query and @Mutation methods')
    .option('-o, --out <dir>', 'Output directory', 'src/resolvers')
    .action(async (name: string, opts: OutDirOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generateResolver({ name, outDir: resolve(opts.out) })
      printGenerated(files, dryRun)
    })

  // ── kick g job <name> ────────────────────────────────────────────────
  gen
    .command('job <name>')
    .description('Generate a @Job queue processor with @Process handlers')
    .option('-o, --out <dir>', 'Output directory', 'src/jobs')
    .option('-q, --queue <name>', 'Queue name (default: <name>-queue)')
    .action(async (name: string, opts: JobOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generateJob({ name, outDir: resolve(opts.out), queue: opts.queue })
      printGenerated(files, dryRun)
    })

  // ── kick g scaffold <name> <fields...> ─────────────────────────────
  gen
    .command('scaffold <name> [fields...]')
    .description(
      'Generate a full CRUD module from field definitions\n' +
        '  Example: kick g scaffold Post title:string body:text:optional published:boolean:optional\n' +
        '  Types: string, text, number, int, float, boolean, date, email, url, uuid, json, enum:a,b,c\n' +
        '  Optional: append :optional (shell-safe):  description:text:optional\n' +
        '            or use ? with quoting:           "description:text?" or "description?:text"',
    )
    .option('--no-entity', 'Skip entity and value object generation')
    .option('--no-tests', 'Skip test file generation')
    .option('--no-pluralize', 'Use singular names (skip auto-pluralization)')
    .option('--modules-dir <dir>', 'Modules directory')
    .action(async (name: string, rawFields: string[], opts: ScaffoldOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      if (rawFields.length === 0) {
        console.error(
          '\n  Error: At least one field is required.\n' +
            '  Usage: kick g scaffold <name> <field:type> [field:type...]\n' +
            '  Example: kick g scaffold Post title:string body:text:optional published:boolean:optional\n' +
            '  Optional: append :optional (shell-safe, no quoting needed)\n',
        )
        process.exit(1)
      }
      const config = await loadKickConfig(process.cwd())
      const mc = resolveModuleConfig(config)
      const modulesDir = opts.modulesDir ?? mc.dir ?? 'src/modules'
      const fields = parseFields(rawFields)
      const files = await generateScaffold({
        name,
        fields,
        modulesDir: resolve(modulesDir),
        noEntity: opts.entity === false,
        noTests: opts.tests === false,
        pluralize: opts.pluralize === false ? false : (mc.pluralize ?? true),
      })
      console.log(`\n  Scaffolded ${name} with ${fields.length} field(s):`)
      for (const f of fields) {
        console.log(`    ${f.name}: ${f.type}${f.optional ? ' (optional)' : ''}`)
      }
      printGenerated(files, dryRun)
      await runPostTypegen(dryRun)
    })

  // ── kick g auth-scaffold ─────────────────────────────────────────────
  gen
    .command('auth-scaffold')
    .description(
      'Generate a complete auth module (register, login, logout, password hashing)\n' +
        '  Includes controller, service, DTOs, and test stubs.',
    )
    .option('-s, --strategy <type>', 'Auth strategy: jwt | session')
    .option('--role-guards', 'Generate role-based guards (default: true)')
    .option('--no-role-guards', 'Skip role-based guard generation')
    .option('-o, --out <dir>', 'Output directory', 'src/modules/auth')
    .action(async (opts: AuthScaffoldOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)

      // Interactive prompts when flags not provided
      let strategy = opts.strategy
      if (!strategy) {
        strategy = await select({
          message: 'Auth strategy',
          options: [
            { value: 'jwt', label: 'JWT', hint: 'stateless token-based auth' },
            { value: 'session', label: 'Session', hint: 'server-side session with cookies' },
          ],
        })
      }

      let roleGuards = opts.roleGuards
      if (roleGuards === undefined) {
        roleGuards = await promptConfirm({
          message: 'Generate role-based guards?',
          initialValue: true,
        })
      }

      const files = await generateAuthScaffold({
        strategy,
        outDir: opts.out,
        roleGuards,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g config ────────────────────────────────────────────────────
  gen
    .command('config')
    .description('Generate a kick.config.ts at the project root')
    .option('--modules-dir <dir>', 'Modules directory path', 'src/modules')
    .option('--repo <type>', 'Default repository type: inmemory | drizzle | prisma', 'inmemory')
    .option('-f, --force', 'Overwrite existing kick.config.ts without prompting')
    .action(async (opts: ConfigOpts, cmd: Command) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generateConfig({
        outDir: resolve('.'),
        modulesDir: opts.modulesDir,
        defaultRepo: opts.repo,
        force: opts.force,
      })
      printGenerated(files, dryRun)
    })
}
