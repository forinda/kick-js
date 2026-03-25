import type { TemplateContext } from './types'

export function generateUseCases(ctx: TemplateContext): { file: string; content: string }[] {
  const { pascal, kebab, plural = '', pluralPascal = '' } = ctx
  return [
    {
      file: `create-${kebab}.use-case.ts`,
      content: `/**
 * Create ${pascal} Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Create${pascal}DTO } from '../dtos/create-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Create${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.create(dto)
  }
}
`,
    },
    {
      file: `get-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Get${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.repo.findById(id)
  }
}
`,
    },
    {
      file: `list-${plural}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class List${pluralPascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
`,
    },
    {
      file: `update-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'
import type { Update${pascal}DTO } from '../dtos/update-${kebab}.dto'
import type { ${pascal}ResponseDTO } from '../dtos/${kebab}-response.dto'

@Service()
export class Update${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.update(id, dto)
  }
}
`,
    },
    {
      file: `delete-${kebab}.use-case.ts`,
      content: `import { Service, Inject } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../../domain/repositories/${kebab}.repository'

@Service()
export class Delete${pascal}UseCase {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
`,
    },
  ]
}
