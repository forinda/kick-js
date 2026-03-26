import type { ModuleContext } from './types'
import { toKebabCase } from '../../utils/naming'
import {
  generateRestModuleIndex,
  generateRestController,
  generateRestConstants,
  generateRestService,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateRepositoryInterface,
  generateInMemoryRepository,
  generateCustomRepository,
  generateDrizzleRepository,
  generatePrismaRepository,
  generateControllerTest,
  generateRepositoryTest,
} from '../templates'

export async function generateRestFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noTests, prismaClientPath, write } = ctx

  // Module index
  await write('index.ts', generateRestModuleIndex({ pascal, kebab, plural, repo }))

  // Constants
  await write(`${kebab}.constants.ts`, generateRestConstants({ pascal, kebab }))

  // Controller (injects service)
  await write(
    `${kebab}.controller.ts`,
    generateRestController({ pascal, kebab, plural, pluralPascal }),
  )

  // Service (wraps repository)
  await write(`${kebab}.service.ts`, generateRestService({ pascal, kebab }))

  // DTOs
  await write(`dtos/create-${kebab}.dto.ts`, generateCreateDTO({ pascal, kebab }))
  await write(`dtos/update-${kebab}.dto.ts`, generateUpdateDTO({ pascal, kebab }))
  await write(`dtos/${kebab}-response.dto.ts`, generateResponseDTO({ pascal, kebab }))

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
