import type { TemplateContext } from './types'

export function generateRepositoryInterface(ctx: TemplateContext): string {
  const { pascal, kebab, dtoPrefix = '../../application/dtos', tokenScope = 'app' } = ctx
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
 *
 * The \`'${tokenScope}/'\` prefix matches the project scope so
 * \`kick-lint\`'s \`token-reserved-prefix\` rule never fires —
 * adopters must NOT use the reserved \`'kick/'\` namespace.
 */
export const ${pascal.toUpperCase()}_REPOSITORY = createToken<I${pascal}Repository>('${tokenScope}/${pascal}/repository')
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
      ...dto,
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
  // The class is named for the MODULE, not the backing store. A
  // `PostgresAuditRepository` that is not yet Postgres is a claim the code does
  // not honour, and the module folder already carries the name — so the store
  // appears only in prose, where it is guidance rather than an assertion.
  const store = repoType || 'your database'
  return (
    `/**
 * ${pascal} Repository
 *
 * UNIMPLEMENTED. Every method throws until you write the ${store}
 * data-access logic — see I${pascal}Repository for the contract.
 *
 * This deliberately does NOT fall back to an in-memory store. A stub that
 * quietly kept rows in a Map would let the app boot, serve traffic and pass a
 * manual smoke test while every write was discarded on restart, with nothing in
 * the types or the logs to say so. Throwing makes the gap impossible to miss
 * and impossible to ship.
 *
 * For a working store while you build this out, the generator also emits
 * InMemory${pascal}Repository — bind that in the module instead.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { Repository } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

/** Names the method that still needs writing, rather than failing vaguely. */
function notImplemented(method: string): never {
  throw new Error(
    \`${pascal}Repository.\${method}() is not implemented — \` +
      \`write the ${store} query, or bind InMemory${pascal}Repository in the module ` +
    `while you build it out.\`,
  )
}

@Repository()
export class ${pascal}Repository implements I${pascal}Repository {
  // TODO: inject your ${store} client/connection here.

  async findById(_id: string): Promise<${pascal}ResponseDTO | null> {
    notImplemented('findById')
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    notImplemented('findAll')
  }

  async findPaginated(_parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    notImplemented('findPaginated')
  }

  async create(_dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    notImplemented('create')
  }

  async update(_id: string, _dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    notImplemented('update')
  }

  async delete(_id: string): Promise<void> {
    notImplemented('delete')
  }
}
`
  )
}
