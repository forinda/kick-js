import type { TemplateContext } from './types'

/** REST service — wraps the repository with CRUD methods */
export function generateRestService(ctx: TemplateContext): string {
  const { pascal, kebab } = ctx
  return `import { Service, Inject, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_REPOSITORY, type ${pascal}Repository } from './${kebab}.repository'
import type { ${pascal}ResponseDTO } from './dtos/${kebab}-response.dto'
import type { Create${pascal}DTO } from './dtos/create-${kebab}.dto'
import type { Update${pascal}DTO } from './dtos/update-${kebab}.dto'

@Service()
export class ${pascal}Service {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: ${pascal}Repository,
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

  async findAfter(query: Parameters<${pascal}Repository['findAfter']>[0]) {
    return this.repo.findAfter(query)
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

/** A field the query config is built from — `kick g scaffold`'s `name:type`. */
export interface QueryField {
  name: string
  type: string
}

// Free text worth a `?q=` search; every other scalar is filter + sort only.
const SEARCHABLE = new Set(['string', 'text', 'email', 'url'])
// Not comparable as a scalar — neither filtered nor sorted.
const UNQUERYABLE = new Set(['json'])

/**
 * REST constants — the query config `ctx.paginate` whitelists against, built
 * from the module's fields. `kick g module` has one `name: string` field.
 */
export function generateRestConstants(ctx: TemplateContext & { fields?: QueryField[] }): string {
  const { pascal, fields = [{ name: 'name', type: 'string' }] } = ctx
  const queryable = fields.filter((f) => !UNQUERYABLE.has(f.type)).map((f) => f.name)
  const searchable = fields.filter((f) => SEARCHABLE.has(f.type)).map((f) => f.name)
  const list = (names: string[]) => `[${names.map((n) => `'${n}'`).join(', ')}]`
  return `import type { QueryFieldConfig } from '@forinda/kickjs'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: QueryFieldConfig = {
  filterable: ${list(queryable)},
  sortable: ${list([...queryable.filter((n) => n !== 'createdAt'), 'createdAt'])},
  searchable: ${list(searchable)},
}
`
}
