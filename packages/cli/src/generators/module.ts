import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { writeFileSafe, fileExists } from '../utils/fs'
import { toPascalCase, toKebabCase, pluralize, pluralizePascal } from '../utils/naming'
import { readFile, writeFile } from 'node:fs/promises'
import type { ProjectPattern } from '../config'
import {
  generateModuleIndex,
  generateRestModuleIndex,
  generateMinimalModuleIndex,
  generateController,
  generateRestController,
  generateConstants,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateUseCases,
  generateRepositoryInterface,
  generateInMemoryRepository,
  generateDrizzleRepository,
  generatePrismaRepository,
  generateDomainService,
  generateEntity,
  generateValueObject,
  generateControllerTest,
  generateRepositoryTest,
  generateRestService,
  generateRestConstants,
  generateCqrsModuleIndex,
  generateCqrsController,
  generateCqrsCommands,
  generateCqrsQueries,
  generateCqrsEvents,
} from './templates'

export type RepoType = 'drizzle' | 'inmemory' | 'prisma'

interface GenerateModuleOptions {
  name: string
  modulesDir: string
  noEntity?: boolean
  noTests?: boolean
  repo?: RepoType
  minimal?: boolean
  force?: boolean
  pattern?: ProjectPattern
  dryRun?: boolean
}

/** Prompt the user for a single-line answer via stdin */
function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

/** Shared context passed to each pattern generator */
interface ModuleContext {
  kebab: string
  pascal: string
  plural: string
  pluralPascal: string
  moduleDir: string
  repo: RepoType
  noEntity: boolean
  noTests: boolean
  write: (relativePath: string, content: string) => Promise<void>
  files: string[]
}

/**
 * Generate a module — structure depends on the project pattern.
 *
 * Patterns:
 *   rest         — flat folder: controller + service + DTOs + repo
 *   ddd          — nested DDD: presentation/ application/ domain/ infrastructure/
 *   graphql      — flat folder: resolver + service + DTOs + repo (future)
 *   cqrs         — commands, queries, events with WS/queue integration
 *   minimal      — just controller + module index
 */
export async function generateModule(options: GenerateModuleOptions): Promise<string[]> {
  const { name, modulesDir, noEntity, noTests, repo = 'inmemory', force, dryRun } = options

  let pattern = options.pattern ?? 'ddd'
  if (options.minimal) pattern = 'minimal'

  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const plural = pluralize(kebab)
  const pluralPascal = pluralizePascal(pascal)
  const moduleDir = join(modulesDir, plural)

  const files: string[] = []
  let overwriteAll = force ?? false

  const write = async (relativePath: string, content: string) => {
    const fullPath = join(moduleDir, relativePath)
    if (dryRun) {
      files.push(fullPath)
      return
    }
    if (!overwriteAll && (await fileExists(fullPath))) {
      const answer = await promptUser(
        `  File already exists: ${relativePath}\n  Overwrite? (y/n/a = yes/no/all) `,
      )
      if (answer === 'a') {
        overwriteAll = true
      } else if (answer !== 'y') {
        console.log(`  Skipped: ${relativePath}`)
        return
      }
    }
    await writeFileSafe(fullPath, content)
    files.push(fullPath)
  }

  const ctx: ModuleContext = {
    kebab,
    pascal,
    plural,
    pluralPascal,
    moduleDir,
    repo,
    noEntity: noEntity ?? false,
    noTests: noTests ?? false,
    write,
    files,
  }

  switch (pattern) {
    case 'minimal':
      await generateMinimalFiles(ctx)
      break
    case 'rest':
      await generateRestFiles(ctx)
      break
    case 'cqrs':
      await generateCqrsFiles(ctx)
      break
    case 'graphql':
    case 'ddd':
    default:
      await generateDddFiles(ctx)
      break
  }

  // Auto-register in modules index (all patterns need this)
  if (!dryRun) {
    await autoRegisterModule(modulesDir, pascal, plural)
  }

  return files
}

// ── Pattern: minimal ────────────────────────────────────────────────────

async function generateMinimalFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, write } = ctx

  await write('index.ts', generateMinimalModuleIndex(pascal, kebab, plural))

  await write(
    `${kebab}.controller.ts`,
    `import { Controller, Get } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'

@Controller()
export class ${pascal}Controller {
  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json({ message: '${pascal} list' })
  }
}
`,
  )
}

// ── Pattern: rest ───────────────────────────────────────────────────────

async function generateRestFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noTests, write } = ctx

  // Module index
  await write('index.ts', generateRestModuleIndex(pascal, kebab, plural, repo))

  // Constants
  await write(`${kebab}.constants.ts`, generateRestConstants(pascal))

  // Controller (injects service)
  await write(`${kebab}.controller.ts`, generateRestController(pascal, kebab, plural, pluralPascal))

  // Service (wraps repository)
  await write(`${kebab}.service.ts`, generateRestService(pascal, kebab))

  // DTOs
  await write(`dtos/create-${kebab}.dto.ts`, generateCreateDTO(pascal, kebab))
  await write(`dtos/update-${kebab}.dto.ts`, generateUpdateDTO(pascal, kebab))
  await write(`dtos/${kebab}-response.dto.ts`, generateResponseDTO(pascal, kebab))

  // Repository interface (flat imports)
  await write(`${kebab}.repository.ts`, generateRepositoryInterface(pascal, kebab, './dtos'))

  // Repository implementation (flat imports)
  const repoFileMap: Record<RepoType, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const repoGeneratorMap: Record<RepoType, () => string> = {
    inmemory: () => generateInMemoryRepository(pascal, kebab, '.', './dtos'),
    drizzle: () => generateDrizzleRepository(pascal, kebab, '.', './dtos'),
    prisma: () => generatePrismaRepository(pascal, kebab, '.', './dtos'),
  }
  await write(`${repoFileMap[repo]}.repository.ts`, repoGeneratorMap[repo]())

  // Tests
  if (!noTests) {
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest(pascal, kebab, plural),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest(pascal, kebab, plural, `../${repoFileMap.inmemory}.repository`),
    )
  }
}

// ── Pattern: cqrs ───────────────────────────────────────────────────────

async function generateCqrsFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noTests, write } = ctx

  // Module index
  await write('index.ts', generateCqrsModuleIndex(pascal, kebab, plural, repo))

  // Constants
  await write(`${kebab}.constants.ts`, generateRestConstants(pascal))

  // Controller (dispatches commands/queries)
  await write(`${kebab}.controller.ts`, generateCqrsController(pascal, kebab, plural, pluralPascal))

  // DTOs
  await write(`dtos/create-${kebab}.dto.ts`, generateCreateDTO(pascal, kebab))
  await write(`dtos/update-${kebab}.dto.ts`, generateUpdateDTO(pascal, kebab))
  await write(`dtos/${kebab}-response.dto.ts`, generateResponseDTO(pascal, kebab))

  // Commands
  const commands = generateCqrsCommands(pascal, kebab)
  for (const cmd of commands) {
    await write(`commands/${cmd.file}`, cmd.content)
  }

  // Queries
  const queries = generateCqrsQueries(pascal, kebab, plural, pluralPascal)
  for (const q of queries) {
    await write(`queries/${q.file}`, q.content)
  }

  // Events
  const events = generateCqrsEvents(pascal, kebab)
  for (const e of events) {
    await write(`events/${e.file}`, e.content)
  }

  // Repository interface (flat imports)
  await write(`${kebab}.repository.ts`, generateRepositoryInterface(pascal, kebab, './dtos'))

  // Repository implementation (flat imports)
  const repoFileMap: Record<RepoType, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const repoGeneratorMap: Record<RepoType, () => string> = {
    inmemory: () => generateInMemoryRepository(pascal, kebab, '.', './dtos'),
    drizzle: () => generateDrizzleRepository(pascal, kebab, '.', './dtos'),
    prisma: () => generatePrismaRepository(pascal, kebab, '.', './dtos'),
  }
  await write(`${repoFileMap[repo]}.repository.ts`, repoGeneratorMap[repo]())

  // Tests
  if (!noTests) {
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest(pascal, kebab, plural),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest(pascal, kebab, plural, `../${repoFileMap.inmemory}.repository`),
    )
  }
}

// ── Pattern: ddd ────────────────────────────────────────────────────────

async function generateDddFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noEntity, noTests, write } = ctx

  // Module index
  await write('index.ts', generateModuleIndex(pascal, kebab, plural, repo))

  // Constants
  await write('constants.ts', generateConstants(pascal))

  // Controller (injects use-cases)
  await write(
    `presentation/${kebab}.controller.ts`,
    generateController(pascal, kebab, plural, pluralPascal),
  )

  // DTOs
  await write(`application/dtos/create-${kebab}.dto.ts`, generateCreateDTO(pascal, kebab))
  await write(`application/dtos/update-${kebab}.dto.ts`, generateUpdateDTO(pascal, kebab))
  await write(`application/dtos/${kebab}-response.dto.ts`, generateResponseDTO(pascal, kebab))

  // Use Cases
  const useCases = generateUseCases(pascal, kebab, plural, pluralPascal)
  for (const uc of useCases) {
    await write(`application/use-cases/${uc.file}`, uc.content)
  }

  // Repository Interface
  await write(
    `domain/repositories/${kebab}.repository.ts`,
    generateRepositoryInterface(pascal, kebab),
  )

  // Domain Service
  await write(`domain/services/${kebab}-domain.service.ts`, generateDomainService(pascal, kebab))

  // Repository Implementation
  const repoFileMap: Record<RepoType, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const repoGeneratorMap: Record<RepoType, () => string> = {
    inmemory: () => generateInMemoryRepository(pascal, kebab),
    drizzle: () => generateDrizzleRepository(pascal, kebab),
    prisma: () => generatePrismaRepository(pascal, kebab),
  }
  await write(
    `infrastructure/repositories/${repoFileMap[repo]}.repository.ts`,
    repoGeneratorMap[repo](),
  )

  // Entity & Value Objects
  if (!noEntity) {
    await write(`domain/entities/${kebab}.entity.ts`, generateEntity(pascal, kebab))
    await write(`domain/value-objects/${kebab}-id.vo.ts`, generateValueObject(pascal, kebab))
  }

  // Tests
  if (!noTests) {
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest(pascal, kebab, plural),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest(pascal, kebab, plural),
    )
  }
}

// ── Auto-register in modules index ──────────────────────────────────────

/** Add the new module to src/modules/index.ts */
async function autoRegisterModule(
  modulesDir: string,
  pascal: string,
  plural: string,
): Promise<void> {
  const indexPath = join(modulesDir, 'index.ts')
  const exists = await fileExists(indexPath)

  if (!exists) {
    await writeFileSafe(
      indexPath,
      `import type { AppModuleClass } from '@forinda/kickjs-core'
import { ${pascal}Module } from './${plural}'

export const modules: AppModuleClass[] = [${pascal}Module]
`,
    )
    return
  }

  let content = await readFile(indexPath, 'utf-8')

  // Add import if not present
  const importLine = `import { ${pascal}Module } from './${plural}'`
  if (!content.includes(`${pascal}Module`)) {
    // Insert import after last existing import
    const lastImportIdx = content.lastIndexOf('import ')
    if (lastImportIdx !== -1) {
      const lineEnd = content.indexOf('\n', lastImportIdx)
      content = content.slice(0, lineEnd + 1) + importLine + '\n' + content.slice(lineEnd + 1)
    } else {
      content = importLine + '\n' + content
    }

    // Add to modules array — handle both empty and existing entries
    // Match the array assignment: `= [...]` or `= [\n...\n]`
    content = content.replace(/(=\s*\[)([\s\S]*?)(])/, (_match, open, existing, close) => {
      const trimmed = existing.trim()
      if (!trimmed) {
        // Empty array: `= []`
        return `${open}${pascal}Module${close}`
      }
      // Existing entries: append with comma
      const needsComma = trimmed.endsWith(',') ? '' : ','
      return `${open}${existing.trimEnd()}${needsComma} ${pascal}Module${close}`
    })
  }

  await writeFile(indexPath, content, 'utf-8')
}
