import { eq, sql } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { IStatsRepository } from '../../domain/repositories/stat.repository'
import { workspaceMembers, projects, tasks, channels, comments, attachments } from '@/db/schema'

@Repository()
export class DrizzleStatsRepository implements IStatsRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async getWorkspaceStats(workspaceId: string) {
    const [memberResult, projectResult, taskResult, openResult, completedResult, channelResult] =
      await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId)),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId)),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(tasks)
          .where(eq(tasks.workspaceId, workspaceId)),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(tasks)
          .where(sql`${tasks.workspaceId} = ${workspaceId} AND ${tasks.status} != 'done'`),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(tasks)
          .where(sql`${tasks.workspaceId} = ${workspaceId} AND ${tasks.status} = 'done'`),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(channels)
          .where(eq(channels.workspaceId, workspaceId)),
      ])

    return {
      memberCount: memberResult[0]?.count ?? 0,
      projectCount: projectResult[0]?.count ?? 0,
      taskCount: taskResult[0]?.count ?? 0,
      openTasks: openResult[0]?.count ?? 0,
      completedTasks: completedResult[0]?.count ?? 0,
      channelCount: channelResult[0]?.count ?? 0,
    }
  }

  async getProjectStats(projectId: string) {
    const [taskResult, statusResult, commentResult, attachmentResult] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),
      this.db
        .select({
          status: tasks.status,
          count: sql<number>`count(*)`,
        })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .groupBy(tasks.status),
      this.db
        .select({ total: sql<number>`sum(${tasks.commentCount})` })
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),
      this.db
        .select({ total: sql<number>`sum(${tasks.attachmentCount})` })
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),
    ])

    const taskCount = taskResult[0]?.count ?? 0
    const tasksByStatus: Record<string, number> = {}
    let completedCount = 0
    for (const row of statusResult) {
      tasksByStatus[row.status] = row.count
      if (row.status === 'done') completedCount = row.count
    }

    return {
      taskCount,
      tasksByStatus,
      completionPercent: taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0,
      commentCount: commentResult[0]?.total ?? 0,
      attachmentCount: attachmentResult[0]?.total ?? 0,
    }
  }
}
