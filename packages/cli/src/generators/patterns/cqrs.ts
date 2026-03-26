import type { ModuleContext } from './types'
import { toKebabCase } from '../../utils/naming'
import {
  generateCqrsModuleIndex,
  generateRestConstants,
  generateCqrsController,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateCqrsCommands,
  generateCqrsQueries,
  generateCqrsEvents,
  generateRepositoryInterface,
  generateInMemoryRepository,
  generateCustomRepository,
  generateDrizzleRepository,
  generatePrismaRepository,
  generateControllerTest,
  generateRepositoryTest,
} from '../templates'

export async function generateCqrsFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noTests, prismaClientPath, write } = ctx

  // Module index
  await write('index.ts', generateCqrsModuleIndex({ pascal, kebab, plural, repo }))

  // Constants
  await write(`${kebab}.constants.ts`, generateRestConstants({ pascal, kebab }))

  // Controller (dispatches commands/queries)
  await write(
    `${kebab}.controller.ts`,
    generateCqrsController({ pascal, kebab, plural, pluralPascal }),
  )

  // DTOs
  await write(`dtos/create-${kebab}.dto.ts`, generateCreateDTO({ pascal, kebab }))
  await write(`dtos/update-${kebab}.dto.ts`, generateUpdateDTO({ pascal, kebab }))
  await write(`dtos/${kebab}-response.dto.ts`, generateResponseDTO({ pascal, kebab }))

  // Commands
  const commands = generateCqrsCommands({ pascal, kebab })
  for (const cmd of commands) {
    await write(`commands/${cmd.file}`, cmd.content)
  }

  // Queries
  const queries = generateCqrsQueries({ pascal, kebab, plural, pluralPascal })
  for (const q of queries) {
    await write(`queries/${q.file}`, q.content)
  }

  // Events
  const events = generateCqrsEvents({ pascal, kebab })
  for (const e of events) {
    await write(`events/${e.file}`, e.content)
  }

  // Repository interface (flat imports)
  await write(
    `${kebab}.repository.ts`,
    generateRepositoryInterface({ pascal, kebab, dtoPrefix: './dtos' }),
  )

  // Repository implementation (flat imports)
  const builtinRepoFileMap: Record<string, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const builtinRepoGeneratorMap: Record<string, () => string> = {
    inmemory: () =>
      generateInMemoryRepository({ pascal, kebab, repoPrefix: '.', dtoPrefix: './dtos' }),
    drizzle: () =>
      generateDrizzleRepository({ pascal, kebab, repoPrefix: '.', dtoPrefix: './dtos' }),
    prisma: () =>
      generatePrismaRepository({
        pascal,
        kebab,
        repoPrefix: '.',
        dtoPrefix: './dtos',
        prismaClientPath,
      }),
  }
  const repoFile = builtinRepoFileMap[repo] ?? `${toKebabCase(repo)}-${kebab}`
  const repoGenerator =
    builtinRepoGeneratorMap[repo] ??
    (() =>
      generateCustomRepository({
        pascal,
        kebab,
        repoType: repo,
        repoPrefix: '.',
        dtoPrefix: './dtos',
      }))
  await write(`${repoFile}.repository.ts`, repoGenerator())

  // Tests
  if (!noTests) {
    // Always generate an in-memory repo for testing — even when using drizzle/prisma
    if (repo !== 'inmemory') {
      await write(
        `in-memory-${kebab}.repository.ts`,
        generateInMemoryRepository({ pascal, kebab, repoPrefix: '.', dtoPrefix: './dtos' }),
      )
    }
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest({ pascal, kebab, plural }),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest({
        pascal,
        kebab,
        plural,
        repoPrefix: `../${builtinRepoFileMap.inmemory ?? `in-memory-${kebab}`}.repository`,
      }),
    )
  }
}
