import type { TemplateContext } from './types'

/** REST service — wraps repository with CRUD methods, replaces use-cases for flat pattern */
export function generateRestService(ctx: TemplateContext): string {
  const { pascal, kebab } = ctx
  return `import { Service, Inject, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from './${kebab}.repository'
import type { ${pascal}ResponseDTO } from './dtos/${kebab}-response.dto'
import type { Create${pascal}DTO } from './dtos/create-${kebab}.dto'
import type { Update${pascal}DTO } from './dtos/update-${kebab}.dto'

@Service()
export class ${pascal}Service {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.repo.findById(id)
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    return this.repo.findAll()
  }

  async findPaginated(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.create(dto)
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.repo.update(id, dto)
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
`
}

/** REST constants — query config for flat pattern */
export function generateRestConstants(ctx: TemplateContext): string {
  const { pascal } = ctx
  return `import type { QueryFieldConfig } from '@forinda/kickjs'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryFieldConfig = {
  filterable: ['name'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
}
`
}
