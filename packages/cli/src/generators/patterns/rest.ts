import type { ModuleContext } from './types'
import {
  generateRestModuleIndex,
  generateRestController,
  generateRestConstants,
  generateRestService,
  generateCreateDTO,
  generateUpdateDTO,
  generateResponseDTO,
  generateRepositoryFactory,
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

  // ONE repository file: factory, contract, token. The factory's return type
  // is the interface, so there is nothing to keep in step and no class named
  // after a store it does not implement.
  await write(
    `${kebab}.repository.ts`,
    generateRepositoryFactory({ pascal, kebab, repoType: repo, dtoPrefix: './dtos', tokenScope }),
  )

  // Tests
  if (!noTests) {
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
        repoPrefix: `../${kebab}.repository`,
      }),
    )
  }
}
