import { Repository, Inject, HttpException } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ITaskRepository, NewTask } from '../../domain/repositories/task.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaTaskRepository implements ITaskRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.task.findUnique({ where: { id } })
  }

  async findByProject(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: { orderIndex: 'asc' },
    })
  }

  async findPaginated(parsed: ParsedQuery, projectId?: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['title', 'key'] })
    const where = projectId
      ? query.where
        ? { AND: [query.where, { projectId }] }
        : { projectId }
      : query.where

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.task.count({ where }),
    ])

    return { data, total }
  }

  async findSubtasks(parentTaskId: string) {
    return this.prisma.task.findMany({
      where: { parentTaskId },
      orderBy: { orderIndex: 'asc' },
    })
  }

  async create(dto: NewTask) {
    return this.prisma.task.create({ data: dto as any })
  }

  async update(id: string, dto: Partial<NewTask>) {
    const task = await this.prisma.task
      .update({ where: { id }, data: dto as any })
      .catch(() => null)
    if (!task) throw HttpException.notFound('Task not found')
    return task
  }

  async delete(id: string) {
    await this.prisma.task.delete({ where: { id } })
  }
}
