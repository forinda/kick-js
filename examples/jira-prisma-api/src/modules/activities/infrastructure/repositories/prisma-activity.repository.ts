import { Repository, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs'
import type {
  IActivityRepository,
  NewActivity,
} from '../../domain/repositories/activity.repository'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaActivityRepository implements IActivityRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findPaginated(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    const query = queryAdapter.build(parsed, { searchColumns: ['action'] })
    const scopeCondition: any = { workspaceId: scope.workspaceId }
    if (scope.projectId) scopeCondition.projectId = scope.projectId
    if (scope.taskId) scopeCondition.taskId = scope.taskId

    const where = query.where
      ? { AND: [query.where, scopeCondition] }
      : scopeCondition

    const [data, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.activity.count({ where }),
    ])

    return { data, total }
  }

  async create(data: NewActivity) {
    return this.prisma.activity.create({ data: data as any })
  }
}
