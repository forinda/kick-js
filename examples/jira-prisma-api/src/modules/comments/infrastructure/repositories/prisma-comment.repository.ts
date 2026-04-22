import { Repository, HttpException, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ICommentRepository, NewComment } from '../../domain/repositories/comment.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaCommentRepository implements ICommentRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.comment.findUnique({ where: { id } })
  }

  async findByTask(taskId: string) {
    return this.prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async findPaginated(parsed: ParsedQuery, taskId?: string) {
    const query = queryAdapter.build(parsed, { searchColumns: ['content'] })
    const where = taskId
      ? query.where
        ? { AND: [query.where, { taskId }] }
        : { taskId }
      : query.where

    const [data, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.comment.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewComment) {
    return this.prisma.comment.create({ data: data as any })
  }

  async update(id: string, data: Partial<NewComment>) {
    const comment = await this.prisma.comment
      .update({ where: { id }, data: data as any })
      .catch(() => null)
    if (!comment) throw HttpException.notFound('Comment not found')
    return comment
  }

  async delete(id: string) {
    await this.prisma.comment.delete({ where: { id } })
  }

  async countByTask(taskId: string) {
    return this.prisma.comment.count({ where: { taskId } })
  }
}
