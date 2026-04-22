import { Repository, Inject, HttpException } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { ParsedQuery } from '@forinda/kickjs'
import type { IProjectRepository, NewProject } from '../../domain/repositories/project.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaProjectRepository implements IProjectRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.project.findUnique({ where: { id } })
  }

  async findByWorkspace(workspaceId: string) {
    return this.prisma.project.findMany({ where: { workspaceId } })
  }

  async findPaginated(parsed: ParsedQuery, workspaceId?: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['name', 'key'] })
    const where = workspaceId
      ? query.where
        ? { AND: [query.where, { workspaceId }] }
        : { workspaceId }
      : query.where

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.project.count({ where }),
    ])

    return { data, total }
  }

  async create(dto: NewProject) {
    return this.prisma.project.create({ data: dto as any })
  }

  async update(id: string, dto: Partial<NewProject>) {
    const project = await this.prisma.project
      .update({ where: { id }, data: dto as any })
      .catch(() => null)
    if (!project) throw HttpException.notFound('Project not found')
    return project
  }

  async incrementTaskCounter(id: string) {
    return this.prisma.project.update({
      where: { id },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true, key: true },
    })
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } })
  }
}
