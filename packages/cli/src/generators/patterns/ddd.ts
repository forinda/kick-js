import type { ModuleContext } from './types'
import { toKebabCase } from '../../utils/naming'
import {
  generateModuleIndex,
  generateConstants,
  generateDrizzleConstants,
  generateController,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateUseCases,
  generateRepositoryInterface,
  generateDomainService,
  generateInMemoryRepository,
  generateCustomRepository,
  generateDrizzleRepository,
  generatePrismaRepository,
  generateEntity,
  generateValueObject,
  generateControllerTest,
  generateRepositoryTest,
} from '../templates'

export async function generateDddFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, pluralPascal, repo, noEntity, noTests, prismaClientPath, write } =
    ctx

  // Module file (named `<kebab>.module.ts` so Vite's module-discovery plugin picks it up)
  await write(`${kebab}.module.ts`, generateModuleIndex({ pascal, kebab, plural, repo }))

  // Constants — use Drizzle-specific type-safe config when repo is drizzle
  await write(
    'constants.ts',
    repo === 'drizzle'
      ? generateDrizzleConstants({ pascal, kebab })
      : generateConstants({ pascal, kebab }),
  )

  // Controller (injects use-cases)
  await write(
    `presentation/${kebab}.controller.ts`,
    generateController({ pascal, kebab, plural, pluralPascal }),
  )

  // DTOs
  await write(`application/dtos/create-${kebab}.dto.ts`, generateCreateDTO({ pascal, kebab }))
  await write(`application/dtos/update-${kebab}.dto.ts`, generateUpdateDTO({ pascal, kebab }))
  await write(`application/dtos/${kebab}-response.dto.ts`, generateResponseDTO({ pascal, kebab }))

  // Use Cases
  const useCases = generateUseCases({ pascal, kebab, plural, pluralPascal })
  for (const uc of useCases) {
    await write(`application/use-cases/${uc.file}`, uc.content)
  }

  // Repository Interface
  await write(
    `domain/repositories/${kebab}.repository.ts`,
    generateRepositoryInterface({ pascal, kebab }),
  )

  // Domain Service
  await write(
    `domain/services/${kebab}-domain.service.ts`,
    generateDomainService({ pascal, kebab }),
  )

  // Repository Implementation
  const builtinRepoFileMap: Record<string, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  const builtinRepoGeneratorMap: Record<string, () => string> = {
    inmemory: () => generateInMemoryRepository({ pascal, kebab }),
    drizzle: () => generateDrizzleRepository({ pascal, kebab }),
    prisma: () => generatePrismaRepository({ pascal, kebab, prismaClientPath }),
  }
  const repoFile = builtinRepoFileMap[repo] ?? `${toKebabCase(repo)}-${kebab}`
  const repoGenerator =
    builtinRepoGeneratorMap[repo] ??
    (() => generateCustomRepository({ pascal, kebab, repoType: repo }))
  await write(`infrastructure/repositories/${repoFile}.repository.ts`, repoGenerator())

  // Entity & Value Objects
  if (!noEntity) {
    await write(`domain/entities/${kebab}.entity.ts`, generateEntity({ pascal, kebab }))
    await write(`domain/value-objects/${kebab}-id.vo.ts`, generateValueObject({ pascal, kebab }))
  }

  // Tests
  if (!noTests) {
    // Always generate an in-memory repo for testing — even when using drizzle/prisma
    if (repo !== 'inmemory') {
      await write(
        `infrastructure/repositories/in-memory-${kebab}.repository.ts`,
        generateInMemoryRepository({ pascal, kebab }),
      )
    }
    await write(
      `__tests__/${kebab}.controller.test.ts`,
      generateControllerTest({ pascal, kebab, plural }),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest({ pascal, kebab, plural }),
    )
  }
}
