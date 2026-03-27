import { eq, and } from 'drizzle-orm'
import { Repository, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ITaskLabelRepository } from '../../domain/repositories/task-label.repository'
import { taskLabels, labels } from '@/db/schema'

@Repository()
export class DrizzleTaskLabelRepository implements ITaskLabelRepository {
  constructor(@Inject(DRIZZLE_DB) private db: PostgresJsDatabase) {}

  async findByTask(taskId: string) {
    const rows = await this.db
      .select({ label: labels })
      .from(taskLabels)
      .innerJoin(labels, eq(taskLabels.labelId, labels.id))
      .where(eq(taskLabels.taskId, taskId))
    return rows.map((r) => r.label)
  }

  async add(taskId: string, labelId: string) {
    const [row] = await this.db.insert(taskLabels).values({ taskId, labelId }).returning()
    return row
  }

  async remove(taskId: string, labelId: string) {
    await this.db
      .delete(taskLabels)
      .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)))
  }

  async removeAllForTask(taskId: string) {
    await this.db.delete(taskLabels).where(eq(taskLabels.taskId, taskId))
  }
}
