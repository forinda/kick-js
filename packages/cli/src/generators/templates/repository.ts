import type { TemplateContext } from './types'

export function generateRepositoryInterface(ctx: TemplateContext): string {
  const { pascal, kebab, dtoPrefix = '../../application/dtos' } = ctx
  return `/**
 * ${pascal} Repository Interface
 *
 * Defines the contract for data access.
 * The interface declares what operations are available;
 * implementations (in-memory, Drizzle, Prisma) fulfill the contract.
 *
 * To swap implementations, change the factory in the module's register() method.
 */
import { createToken } from '@forinda/kickjs'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'
import type { ParsedQuery } from '@forinda/kickjs'

export interface I${pascal}Repository {
  findById(id: string): Promise<${pascal}ResponseDTO | null>
  findAll(): Promise<${pascal}ResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }>
  create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO>
  update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO>
  delete(id: string): Promise<void>
}

/**
 * Collision-safe DI token bound to \`I${pascal}Repository\`.
 * \`container.resolve(${pascal.toUpperCase()}_REPOSITORY)\` and
 * \`@Inject(${pascal.toUpperCase()}_REPOSITORY)\` both return the typed
 * interface — no manual generic, no \`any\` cast.
 */
export const ${pascal.toUpperCase()}_REPOSITORY = createToken<I${pascal}Repository>('app/${kebab}/repository')
`
}

export function generateInMemoryRepository(ctx: TemplateContext): string {
  const {
    pascal,
    kebab,
    repoPrefix = '../../domain/repositories',
    dtoPrefix = '../../application/dtos',
  } = ctx
  return `/**
 * In-Memory ${pascal} Repository
 *
 * Implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

@Repository()
export class InMemory${pascal}Repository implements I${pascal}Repository {
  private store = new Map<string, ${pascal}ResponseDTO>()

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const now = new Date().toISOString()
    const entity: ${pascal}ResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('${pascal} not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('${pascal} not found')
    this.store.delete(id)
  }
}
`
}

export function generateCustomRepository(ctx: TemplateContext): string {
  const {
    pascal,
    kebab,
    repoType = '',
    repoPrefix = '../../domain/repositories',
    dtoPrefix = '../../application/dtos',
  } = ctx
  const repoTypePascal =
    repoType.charAt(0).toUpperCase() +
    repoType.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  return `/**
 * ${repoTypePascal} ${pascal} Repository
 *
 * Stub implementation for a custom '${repoType}' repository.
 * Implements the repository interface using an in-memory Map as a placeholder.
 *
 * TODO: Replace the in-memory Map with your ${repoType} data-access logic.
 * See I${pascal}Repository for the interface contract.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

@Repository()
export class ${repoTypePascal}${pascal}Repository implements I${pascal}Repository {
  // TODO: Replace with your ${repoType} client/connection
  private store = new Map<string, ${pascal}ResponseDTO>()

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    // TODO: Implement with ${repoType}
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    // TODO: Implement with ${repoType}
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    // TODO: Implement with ${repoType}
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with ${repoType}
    const now = new Date().toISOString()
    const entity: ${pascal}ResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with ${repoType}
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('${pascal} not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    // TODO: Implement with ${repoType}
    if (!this.store.has(id)) throw HttpException.notFound('${pascal} not found')
    this.store.delete(id)
  }
}
`
}
