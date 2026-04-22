import { Repository, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, and } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { taskAssignees } from '@/db/schema'
import type { ITaskAssigneeRepository } from '../../domain/repositories/task-assignee.repository'

@Repository()
export class DrizzleTaskAssigneeRepository implements ITaskAssigneeRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findByTask(taskId: string) {
    return this.db.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId))
  }

  async add(taskId: string, userId: string) {
    const [result] = await this.db.insert(taskAssignees).values({ taskId, userId }).returning()
    return result
  }

  async addMany(taskId: string, userIds: string[]) {
    if (userIds.length === 0) return
    await this.db.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })))
  }

  async remove(taskId: string, userId: string) {
    await this.db
      .delete(taskAssignees)
      .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
  }

  async removeAllForTask(taskId: string) {
    await this.db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId))
  }
}
