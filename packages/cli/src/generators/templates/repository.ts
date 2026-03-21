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
 * Requires a Drizzle database instance injected via the DI container.
 *
 * TODO: Update the schema import to match your Drizzle schema file.
 * TODO: Replace 'db' injection token with your actual database token.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { eq, sql } from 'drizzle-orm'
import { Repository, HttpException, Autowired } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

// TODO: Import your Drizzle schema table — e.g.:
// import { ${kebab}s } from '@/db/schema'

// TODO: Import your Drizzle DB injection token — e.g.:
// import { DRIZZLE_DB } from '@/db/drizzle.provider'

@Repository()
export class Drizzle${pascal}Repository implements I${pascal}Repository {
  // TODO: Uncomment and configure your Drizzle DB injection:
  // @Autowired(DRIZZLE_DB) private db!: DrizzleDB

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    // TODO: Implement with Drizzle
    // const [row] = await this.db.select().from(${kebab}s).where(eq(${kebab}s.id, id))
    // return row ?? null
    throw new Error('Drizzle ${pascal} repository not yet implemented — update schema imports and queries')
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    // TODO: Implement with Drizzle
    // return this.db.select().from(${kebab}s)
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    // TODO: Implement with Drizzle
    // const data = await this.db.select().from(${kebab}s)
    //   .limit(parsed.pagination.limit)
    //   .offset(parsed.pagination.offset)
    // const [{ count }] = await this.db.select({ count: sql\`count(*)\` }).from(${kebab}s)
    // return { data, total: Number(count) }
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // const [row] = await this.db.insert(${kebab}s).values(dto).returning()
    // return row
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // const [row] = await this.db.update(${kebab}s).set(dto).where(eq(${kebab}s.id, id)).returning()
    // if (!row) throw HttpException.notFound('${pascal} not found')
    // return row
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async delete(id: string): Promise<void> {
    // TODO: Implement with Drizzle
    // const result = await this.db.delete(${kebab}s).where(eq(${kebab}s.id, id))
    // if (!result.rowCount) throw HttpException.notFound('${pascal} not found')
    throw new Error('Drizzle ${pascal} repository not yet implemented')
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
 * TODO: Ensure your Prisma schema has a '${pascal}' model defined.
 * TODO: Replace 'PRISMA_CLIENT' with your actual Prisma injection token.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { Repository, HttpException, Autowired } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

// TODO: Import your Prisma injection token — e.g.:
// import { PRISMA_CLIENT } from '@/db/prisma.provider'
// import type { PrismaClient } from '@prisma/client'

@Repository()
export class Prisma${pascal}Repository implements I${pascal}Repository {
  // TODO: Uncomment and configure your Prisma injection:
  // @Autowired(PRISMA_CLIENT) private prisma!: PrismaClient

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    // TODO: Implement with Prisma
    // return this.prisma.${camel}.findUnique({ where: { id } })
    throw new Error('Prisma ${pascal} repository not yet implemented — update Prisma imports and queries')
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    // TODO: Implement with Prisma
    // return this.prisma.${camel}.findMany()
    throw new Error('Prisma ${pascal} repository not yet implemented')
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    // TODO: Implement with Prisma
    // const [data, total] = await Promise.all([
    //   this.prisma.${camel}.findMany({
    //     skip: parsed.pagination.offset,
    //     take: parsed.pagination.limit,
    //   }),
    //   this.prisma.${camel}.count(),
    // ])
    // return { data, total }
    throw new Error('Prisma ${pascal} repository not yet implemented')
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Prisma
    // return this.prisma.${camel}.create({ data: dto })
    throw new Error('Prisma ${pascal} repository not yet implemented')
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Prisma
    // const row = await this.prisma.${camel}.update({ where: { id }, data: dto })
    // if (!row) throw HttpException.notFound('${pascal} not found')
    // return row
    throw new Error('Prisma ${pascal} repository not yet implemented')
  }

  async delete(id: string): Promise<void> {
    // TODO: Implement with Prisma
    // await this.prisma.${camel}.delete({ where: { id } })
    throw new Error('Prisma ${pascal} repository not yet implemented')
  }
}
`
}
