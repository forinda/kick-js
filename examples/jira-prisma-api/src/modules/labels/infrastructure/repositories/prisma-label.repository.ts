import { Repository, HttpException, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { ILabelRepository, NewLabel } from '../../domain/repositories/label.repository'
import { LABEL_QUERY_CONFIG } from '../../constants'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaLabelRepository implements ILabelRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.label.findUnique({ where: { id } })
  }

  async findByWorkspace(workspaceId: string) {
    return this.prisma.label.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    })
  }

  async findPaginated(parsed: ParsedQuery, workspaceId?: string) {
    const query = queryAdapter.build(parsed, LABEL_QUERY_CONFIG)
    const where = workspaceId
      ? query.where
        ? { AND: [query.where, { workspaceId }] }
        : { workspaceId }
      : query.where

    const [data, total] = await Promise.all([
      this.prisma.label.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.label.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewLabel) {
    return this.prisma.label.create({ data: data as any })
  }

  async update(id: string, data: Partial<NewLabel>) {
    const label = await this.prisma.label
      .update({ where: { id }, data: data as any })
      .catch(() => null)
    if (!label) throw HttpException.notFound('Label not found')
    return label
  }

  async delete(id: string) {
    await this.prisma.label.delete({ where: { id } })
  }
}
