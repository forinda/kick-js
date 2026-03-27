import type { TemplateContext } from '../types'

export function generatePrismaRepository(ctx: TemplateContext): string {
  const {
    pascal,
    kebab,
    repoPrefix = '../../domain/repositories',
    dtoPrefix = '../../application/dtos',
  } = ctx
  const camel = kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  return `/**
 * Prisma ${pascal} Repository
 *
 * Implements the repository interface using Prisma Client.
 * Requires a PrismaClient instance injected via the DI container.
 *
 * Ensure your Prisma schema has a '${pascal}' model defined.
 *
 * For full Prisma field-level type safety, replace PrismaModelDelegate with your PrismaClient:
 *   @Inject(PRISMA_CLIENT) private prisma!: PrismaClient
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT, type PrismaModelDelegate } from '@forinda/kickjs-prisma'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

@Repository()
export class Prisma${pascal}Repository implements I${pascal}Repository {
  @Inject(PRISMA_CLIENT) private prisma!: { ${camel}: PrismaModelDelegate }

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    return this.prisma.${camel}.findUnique({ where: { id } }) as Promise<${pascal}ResponseDTO | null>
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    return this.prisma.${camel}.findMany() as Promise<${pascal}ResponseDTO[]>
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    const [data, total] = await Promise.all([
      this.prisma.${camel}.findMany({
        skip: parsed.pagination.offset,
        take: parsed.pagination.limit,
      }) as Promise<${pascal}ResponseDTO[]>,
      this.prisma.${camel}.count(),
    ])
    return { data, total }
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    return this.prisma.${camel}.create({ data: dto as Record<string, unknown> }) as Promise<${pascal}ResponseDTO>
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    const existing = await this.prisma.${camel}.findUnique({ where: { id } })
    if (!existing) throw HttpException.notFound('${pascal} not found')
    return this.prisma.${camel}.update({ where: { id }, data: dto as Record<string, unknown> }) as Promise<${pascal}ResponseDTO>
  }

  async delete(id: string): Promise<void> {
    await this.prisma.${camel}.deleteMany({ where: { id } })
  }
}
`
}
