import { resolve } from 'node:path'
import type { Command } from 'commander'
import { generateModule } from '../generators/module'
import type { RepoType } from '../generators/module'
import { generateAdapter } from '../generators/adapter'
import { generateMiddleware } from '../generators/middleware'
import { generateGuard } from '../generators/guard'
import { generateService } from '../generators/service'
import { generateController } from '../generators/controller'
import { generateDto } from '../generators/dto'
import { generateConfig } from '../generators/config'
import { generateResolver } from '../generators/resolver'
import { generateJob } from '../generators/job'
import { generateScaffold, parseFields } from '../generators/scaffold'
import { generateTest } from '../generators/test'
import { loadKickConfig } from '../config'
import { setDryRun } from '../utils/fs'

/** Check if --dry-run was passed on the parent generate command */
function isDryRun(cmd: any): boolean {
  return cmd.parent?.opts()?.dryRun ?? false
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

function printGeneratorList(): void {
  console.log('\n  Available generators:\n')
  const maxName = Math.max(...GENERATORS.map((g) => g.name.length))
  for (const g of GENERATORS) {
    console.log(`    kick g ${g.name.padEnd(maxName + 2)} ${g.description}`)
  }
  console.log()
}

export function registerGenerateCommand(program: Command): void {
  const gen = program
    .command('generate')
    .alias('g')
    .description('Generate code scaffolds')
    .option('--list', 'List all available generators')
    .option('--dry-run', 'Preview files that would be generated without writing them')
    .action((opts: any) => {
      if (opts.list) {
        printGeneratorList()
      } else {
        gen.help()
      }
    })

  // ── kick g module <name> ────────────────────────────────────────────
  gen
    .command('module <name>')
    .description('Generate a module (structure depends on project pattern)')
    .option('--no-entity', 'Skip entity and value object generation')
    .option('--no-tests', 'Skip test file generation')
    .option('--repo <type>', 'Repository implementation: inmemory | drizzle | prisma')
    .option('--pattern <pattern>', 'Override project pattern: rest | ddd | cqrs | minimal')
    .option('--minimal', 'Shorthand for --pattern minimal')
    .option('--modules-dir <dir>', 'Modules directory')
    .option('-f, --force', 'Overwrite existing files without prompting')
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = opts.modulesDir ?? config?.modulesDir ?? 'src/modules'
      const repo: RepoType = opts.repo ?? config?.defaultRepo ?? 'inmemory'
      const pattern = opts.pattern ?? config?.pattern ?? 'ddd'

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
      })
      printGenerated(files, dryRun)
    })

  // ── kick g adapter <name> ──────────────────────────────────────────
  gen
    .command('adapter <name>')
    .description('Generate an AppAdapter with lifecycle hooks and middleware support')
    .option('-o, --out <dir>', 'Output directory', 'src/adapters')
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const files = await generateAdapter({ name, outDir: resolve(opts.out) })
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateMiddleware({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateGuard({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateService({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateController({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
      })
      printGenerated(files, dryRun)
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateDto({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
        pattern: config?.pattern,
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
    .action(async (name: string, opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      const config = await loadKickConfig(process.cwd())
      const modulesDir = config?.modulesDir ?? 'src/modules'
      const files = await generateTest({
        name,
        outDir: opts.out,
        moduleName: opts.module,
        modulesDir,
      })
      printGenerated(files, dryRun)
    })

  // ── kick g resolver <name> ────────────────────────────────────────────
  gen
    .command('resolver <name>')
    .description('Generate a GraphQL @Resolver class with @Query and @Mutation methods')
    .option('-o, --out <dir>', 'Output directory', 'src/resolvers')
    .action(async (name: string, opts: any, cmd: any) => {
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
    .action(async (name: string, opts: any, cmd: any) => {
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
        '  Example: kick g scaffold Post title:string body:text published:boolean?\n' +
        '  Types: string, text, number, int, float, boolean, date, email, url, uuid, json, enum:a,b,c\n' +
        '  Append ? for optional fields: description:text?',
    )
    .option('--no-entity', 'Skip entity and value object generation')
    .option('--no-tests', 'Skip test file generation')
    .option('--modules-dir <dir>', 'Modules directory')
    .action(async (name: string, rawFields: string[], opts: any, cmd: any) => {
      const dryRun = isDryRun(cmd)
      setDryRun(dryRun)
      if (rawFields.length === 0) {
        console.error(
          '\n  Error: At least one field is required.\n' +
            '  Usage: kick g scaffold <name> <field:type> [field:type...]\n' +
            '  Example: kick g scaffold Post title:string body:text published:boolean\n',
        )
        process.exit(1)
      }
      const config = await loadKickConfig(process.cwd())
      const modulesDir = opts.modulesDir ?? config?.modulesDir ?? 'src/modules'
      const fields = parseFields(rawFields)
      const files = await generateScaffold({
        name,
        fields,
        modulesDir: resolve(modulesDir),
        noEntity: opts.entity === false,
        noTests: opts.tests === false,
      })
      console.log(`\n  Scaffolded ${name} with ${fields.length} field(s):`)
      for (const f of fields) {
        console.log(`    ${f.name}: ${f.type}${f.optional ? ' (optional)' : ''}`)
      }
      printGenerated(files, dryRun)
    })

  // ── kick g config ────────────────────────────────────────────────────
  gen
    .command('config')
    .description('Generate a kick.config.ts at the project root')
    .option('--modules-dir <dir>', 'Modules directory path', 'src/modules')
    .option('--repo <type>', 'Default repository type: inmemory | drizzle | prisma', 'inmemory')
    .option('-f, --force', 'Overwrite existing kick.config.ts without prompting')
    .action(async (opts: any, cmd: any) => {
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
