import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { ITaskAssigneeRepository } from '../../domain/repositories/task-assignee.repository'

@Repository()
export class PrismaTaskAssigneeRepository implements ITaskAssigneeRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findByTask(taskId: string) {
    return this.prisma.taskAssignee.findMany({ where: { taskId } })
  }

  async add(taskId: string, userId: string) {
    return this.prisma.taskAssignee.create({ data: { taskId, userId } })
  }

  async addMany(taskId: string, userIds: string[]) {
    if (userIds.length === 0) return
    await this.prisma.taskAssignee.createMany({
      data: userIds.map((userId) => ({ taskId, userId })),
    })
  }

  async remove(taskId: string, userId: string) {
    await this.prisma.taskAssignee.delete({
      where: { taskId_userId: { taskId, userId } },
    })
  }

  async removeAllForTask(taskId: string) {
    await this.prisma.taskAssignee.deleteMany({ where: { taskId } })
  }
}
