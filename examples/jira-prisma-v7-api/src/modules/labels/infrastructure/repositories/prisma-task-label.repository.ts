import { Repository, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { ITaskLabelRepository } from '../../domain/repositories/task-label.repository'

@Repository()
export class PrismaTaskLabelRepository implements ITaskLabelRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findByTask(taskId: string) {
    const rows = await this.prisma.taskLabel.findMany({
      where: { taskId },
      include: { label: true },
    })
    return rows.map((r: any) => r.label)
  }

  async add(taskId: string, labelId: string) {
    return this.prisma.taskLabel.create({ data: { taskId, labelId } })
  }

  async remove(taskId: string, labelId: string) {
    await this.prisma.taskLabel.delete({
      where: { taskId_labelId: { taskId, labelId } },
    })
  }

  async removeAllForTask(taskId: string) {
    await this.prisma.taskLabel.deleteMany({ where: { taskId } })
  }
}
