import { Repository, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import type { IStatsRepository } from '../../domain/repositories/stat.repository'

@Repository()
export class PrismaStatsRepository implements IStatsRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async getWorkspaceStats(workspaceId: string) {
    const [memberCount, projectCount, taskCount, openTasks, completedTasks, channelCount] =
      await Promise.all([
        this.prisma.workspaceMember.count({ where: { workspaceId } }),
        this.prisma.project.count({ where: { workspaceId } }),
        this.prisma.task.count({ where: { workspaceId } }),
        this.prisma.task.count({ where: { workspaceId, status: { not: 'done' } } }),
        this.prisma.task.count({ where: { workspaceId, status: 'done' } }),
        this.prisma.channel.count({ where: { workspaceId } }),
      ])

    return {
      memberCount,
      projectCount,
      taskCount,
      openTasks,
      completedTasks,
      channelCount,
    }
  }

  async getProjectStats(projectId: string) {
    const [taskCount, statusGroups, commentSum, attachmentSum] = await Promise.all([
      this.prisma.task.count({ where: { projectId } }),
      this.prisma.task.groupBy({
        by: ['status'],
        where: { projectId },
        _count: { _all: true },
      }),
      this.prisma.task.aggregate({
        where: { projectId },
        _sum: { commentCount: true },
      }),
      this.prisma.task.aggregate({
        where: { projectId },
        _sum: { attachmentCount: true },
      }),
    ])

    const tasksByStatus: Record<string, number> = {}
    let completedCount = 0
    for (const row of statusGroups) {
      tasksByStatus[row.status] = row._count._all
      if (row.status === 'done') completedCount = row._count._all
    }

    return {
      taskCount,
      tasksByStatus,
      completionPercent: taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0,
      commentCount: commentSum._sum.commentCount ?? 0,
      attachmentCount: attachmentSum._sum.attachmentCount ?? 0,
    }
  }
}
