import { resolve } from 'node:path'
import type { Command } from 'commander'
import { generateModule } from '../generators/module'
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

function printGenerated(files: string[]): void {
  const cwd = process.cwd()
  console.log(`\n  Generated ${files.length} file${files.length === 1 ? '' : 's'}:`)
  for (const f of files) {
    console.log(`    ${f.replace(cwd + '/', '')}`)
  }
  console.log()
}

export function registerGenerateCommand(program: Command): void {
  const gen = program.command('generate').alias('g').description('Generate code scaffolds')

  // ── kick g module <name> ────────────────────────────────────────────
  gen
    .command('module <name>')
    .description('Generate a full DDD module with all layers')
    .option('--no-entity', 'Skip entity and value object generation')
    .option('--no-tests', 'Skip test file generation')
    .option('--repo <type>', 'Repository implementation: inmemory | drizzle', 'inmemory')
    .option('--minimal', 'Only generate index.ts and controller')
    .option('--modules-dir <dir>', 'Modules directory', 'src/modules')
    .action(async (name: string, opts: any) => {
      const files = await generateModule({
        name,
        modulesDir: resolve(opts.modulesDir),
        noEntity: opts.entity === false,
        noTests: opts.tests === false,
        repo: opts.repo,
        minimal: opts.minimal,
      })
      printGenerated(files)
    })

  // ── kick g adapter <name> ──────────────────────────────────────────
  gen
    .command('adapter <name>')
    .description('Generate an AppAdapter with lifecycle hooks and middleware support')
    .option('-o, --out <dir>', 'Output directory', 'src/adapters')
    .action(async (name: string, opts: any) => {
      const files = await generateAdapter({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g middleware <name> ────────────────────────────────────────
  gen
    .command('middleware <name>')
    .description('Generate an Express middleware function')
    .option('-o, --out <dir>', 'Output directory', 'src/middleware')
    .action(async (name: string, opts: any) => {
      const files = await generateMiddleware({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g guard <name> ────────────────────────────────────────────
  gen
    .command('guard <name>')
    .description('Generate a route guard (auth, roles, etc.)')
    .option('-o, --out <dir>', 'Output directory', 'src/guards')
    .action(async (name: string, opts: any) => {
      const files = await generateGuard({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g service <name> ──────────────────────────────────────────
  gen
    .command('service <name>')
    .description('Generate a @Service() class')
    .option('-o, --out <dir>', 'Output directory', 'src/services')
    .action(async (name: string, opts: any) => {
      const files = await generateService({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g controller <name> ───────────────────────────────────────
  gen
    .command('controller <name>')
    .description('Generate a @Controller() class with basic routes')
    .option('-o, --out <dir>', 'Output directory', 'src/controllers')
    .action(async (name: string, opts: any) => {
      const files = await generateController({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g dto <name> ──────────────────────────────────────────────
  gen
    .command('dto <name>')
    .description('Generate a Zod DTO schema')
    .option('-o, --out <dir>', 'Output directory', 'src/dtos')
    .action(async (name: string, opts: any) => {
      const files = await generateDto({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g resolver <name> ────────────────────────────────────────────
  gen
    .command('resolver <name>')
    .description('Generate a GraphQL @Resolver class with @Query and @Mutation methods')
    .option('-o, --out <dir>', 'Output directory', 'src/resolvers')
    .action(async (name: string, opts: any) => {
      const files = await generateResolver({ name, outDir: resolve(opts.out) })
      printGenerated(files)
    })

  // ── kick g job <name> ────────────────────────────────────────────────
  gen
    .command('job <name>')
    .description('Generate a @Job queue processor with @Process handlers')
    .option('-o, --out <dir>', 'Output directory', 'src/jobs')
    .option('-q, --queue <name>', 'Queue name (default: <name>-queue)')
    .action(async (name: string, opts: any) => {
      const files = await generateJob({ name, outDir: resolve(opts.out), queue: opts.queue })
      printGenerated(files)
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
    .option('--modules-dir <dir>', 'Modules directory', 'src/modules')
    .action(async (name: string, rawFields: string[], opts: any) => {
      if (rawFields.length === 0) {
        console.error(
          '\n  Error: At least one field is required.\n' +
            '  Usage: kick g scaffold <name> <field:type> [field:type...]\n' +
            '  Example: kick g scaffold Post title:string body:text published:boolean\n',
        )
        process.exit(1)
      }
      const fields = parseFields(rawFields)
      const files = await generateScaffold({
        name,
        fields,
        modulesDir: resolve(opts.modulesDir),
        noEntity: opts.entity === false,
        noTests: opts.tests === false,
      })
      console.log(`\n  Scaffolded ${name} with ${fields.length} field(s):`)
      for (const f of fields) {
        console.log(`    ${f.name}: ${f.type}${f.optional ? ' (optional)' : ''}`)
      }
      printGenerated(files)
    })

  // ── kick g config ────────────────────────────────────────────────────
  gen
    .command('config')
    .description('Generate a kick.config.ts at the project root')
    .option('--modules-dir <dir>', 'Modules directory path', 'src/modules')
    .option('--repo <type>', 'Default repository type: inmemory | drizzle', 'inmemory')
    .option('-f, --force', 'Overwrite existing kick.config.ts without prompting')
    .action(async (opts: any) => {
      const files = await generateConfig({
        outDir: resolve('.'),
        modulesDir: opts.modulesDir,
        defaultRepo: opts.repo,
        force: opts.force,
      })
      printGenerated(files)
    })
}
