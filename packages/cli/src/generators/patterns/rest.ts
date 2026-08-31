import type { ModuleContext } from './types'
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
  generateControllerTest,
  generateRepositoryTest,
} from '../templates'

export async function generateRestFiles(ctx: ModuleContext): Promise<void> {
  const {
    pascal,
    kebab,
    plural,
    pluralPascal,
    repo,
    noTests,
    tokenScope,
    style,
    testHarness,
    write,
  } = ctx
  const swagger = ctx.swagger ?? false

  // Module file (named `<kebab>.module.ts` so Vite's module-discovery plugin picks it up)
  await write(`${kebab}.module.ts`, generateRestModuleIndex({ pascal, kebab, plural, repo, style }))

  // Constants
  await write(`${kebab}.constants.ts`, generateRestConstants({ pascal, kebab }))

  // Controller (injects service)
  await write(
    `${kebab}.controller.ts`,
    generateRestController({ pascal, kebab, plural, pluralPascal, swagger }),
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
    generateRepositoryInterface({ pascal, kebab, dtoPrefix: './dtos', tokenScope }),
  )

  // Repository implementation (flat imports). `inmemory` is the only
  // built-in (zero-dep working impl); every other name scaffolds a
  // generic custom stub — prisma/drizzle no longer have dedicated
  // generators (see `warnIfDeprecatedRepo`).
  const isInMemory = repo === 'inmemory'
  // Full basename. Only `inmemory` is named for what it is; every other repo
  // gets the same unimplemented stub, so it takes the module's name rather
  // than asserting a store it does not implement yet. `.impl` because
  // `${kebab}.repository.ts` is already the interface.
  const repoFile = isInMemory ? `in-memory-${kebab}.repository` : `${kebab}.repository.impl`
  const repoContent = isInMemory
    ? generateInMemoryRepository({ pascal, kebab, repoPrefix: '.', dtoPrefix: './dtos' })
    : generateCustomRepository({
        pascal,
        kebab,
        repoType: repo,
        repoPrefix: '.',
        dtoPrefix: './dtos',
      })
  await write(`${repoFile}.ts`, repoContent)

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
      generateControllerTest({ pascal, kebab, plural, style, testHarness }),
    )
    await write(
      `__tests__/${kebab}.repository.test.ts`,
      generateRepositoryTest({
        pascal,
        kebab,
        plural,
        repoPrefix: `../in-memory-${kebab}.repository`,
      }),
    )
  }
}
