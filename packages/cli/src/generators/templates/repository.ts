export function generateRepositoryInterface(
  pascal: string,
  kebab: string,
  dtoPrefix = '../../application/dtos',
): string {
  return `/**
 * ${pascal} Repository Interface
 *
 * Defines the contract for data access.
 * The interface declares what operations are available;
 * implementations (in-memory, Drizzle, Prisma) fulfill the contract.
 *
 * To swap implementations, change the factory in the module's register() method.
 */
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

export interface I${pascal}Repository {
  findById(id: string): Promise<${pascal}ResponseDTO | null>
  findAll(): Promise<${pascal}ResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }>
  create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO>
  update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO>
  delete(id: string): Promise<void>
}

export const ${pascal.toUpperCase()}_REPOSITORY = Symbol('I${pascal}Repository')
`
}

export function generateInMemoryRepository(
  pascal: string,
  kebab: string,
  repoPrefix = '../../domain/repositories',
  dtoPrefix = '../../application/dtos',
): string {
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
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
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

export function generateDrizzleRepository(
  pascal: string,
  kebab: string,
  repoPrefix = '../../domain/repositories',
  dtoPrefix = '../../application/dtos',
): string {
  return `/**
 * Drizzle ${pascal} Repository
 *
 * Implements the repository interface using Drizzle ORM.
 * Uses buildFromColumns() with Column objects for type-safe query building.
 *
 * TODO: Update the schema import to match your Drizzle schema file.
 * TODO: Replace DRIZZLE_DB injection token with your actual database token.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc, count, sql } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from '../../constants'

// TODO: Import your Drizzle schema table — e.g.:
// import { ${kebab}s } from '@/db/schema'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc,
})

@Repository()
export class Drizzle${pascal}Repository implements I${pascal}Repository {
  constructor(@Inject(DRIZZLE_DB) private db: any) {}

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    // TODO: Implement with Drizzle
    // const row = this.db.select().from(${kebab}s).where(eq(${kebab}s.id, id)).get()
    // return row ?? null
    throw new Error('Drizzle ${pascal} repository not yet implemented — update schema imports and queries')
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    // TODO: Implement with Drizzle
    // return this.db.select().from(${kebab}s).all()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    // TODO: Use buildFromColumns() with your query config for type-safe filtering
    // const query = queryAdapter.buildFromColumns(parsed, ${pascal.toUpperCase()}_QUERY_CONFIG)
    //
    // const data = this.db
    //   .select().from(${kebab}s).$dynamic()
    //   .where(query.where).orderBy(...query.orderBy)
    //   .limit(query.limit).offset(query.offset).all()
    //
    // const totalResult = this.db
    //   .select({ count: count() }).from(${kebab}s)
    //   .$dynamic().where(query.where).get()
    //
    // return { data, total: totalResult?.count ?? 0 }
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // return this.db.insert(${kebab}s).values(dto).returning().get()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // const row = this.db.update(${kebab}s).set(dto).where(eq(${kebab}s.id, id)).returning().get()
    // if (!row) throw HttpException.notFound('${pascal} not found')
    // return row
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async delete(id: string): Promise<void> {
    // TODO: Implement with Drizzle
    // this.db.delete(${kebab}s).where(eq(${kebab}s.id, id)).run()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }
}
`
}

export function generateCustomRepository(
  pascal: string,
  kebab: string,
  repoType: string,
  repoPrefix = '../../domain/repositories',
  dtoPrefix = '../../application/dtos',
): string {
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
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
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

export function generatePrismaRepository(
  pascal: string,
  kebab: string,
  repoPrefix = '../../domain/repositories',
  dtoPrefix = '../../application/dtos',
): string {
  const camel = kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  return `/**
 * Prisma ${pascal} Repository
 *
 * Implements the repository interface using Prisma Client.
 * Requires a PrismaClient instance injected via the DI container.
 *
 * Ensure your Prisma schema has a '${pascal}' model defined.
 *
 * NOTE: For Prisma 7+, change the PrismaClient import to your generated output path:
 *   import type { PrismaClient } from '@/generated/prisma'
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
// Prisma 5/6: '@prisma/client' | Prisma 7+: your generated output path (e.g. '@/generated/prisma')
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

@Repository()
export class Prisma${pascal}Repository implements I${pascal}Repository {
  @Inject(PRISMA_CLIENT) private prisma!: PrismaClient

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    return (this.prisma.${camel} as any).findUnique({ where: { id } })
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    return (this.prisma.${camel} as any).findMany()
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    const [data, total] = await Promise.all([
      (this.prisma.${camel} as any).findMany({
        skip: parsed.pagination.offset,
        take: parsed.pagination.limit,
      }),
      (this.prisma.${camel} as any).count(),
    ])
    return { data, total }
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return (this.prisma.${camel} as any).create({ data: dto })
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const existing = await (this.prisma.${camel} as any).findUnique({ where: { id } })
    if (!existing) throw HttpException.notFound('${pascal} not found')
    return (this.prisma.${camel} as any).update({ where: { id }, data: dto })
  }

  async delete(id: string): Promise<void> {
    await (this.prisma.${camel} as any).deleteMany({ where: { id } })
  }
}
`
}
