import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

export interface NewTask {
  projectId: string
  workspaceId: string
  key: string
  title: string
  reporterId: string
  description?: string | null
  /** Maps to a kanban column literal — kept loose so the DB default flows. */
  status?: string
  /** Allowed values are constrained by the `task_priority` PG enum. */
  priority?: 'critical' | 'high' | 'medium' | 'low' | 'none'
  estimatePoints?: number | null
  parentTaskId?: string | null
  dueDate?: Date | null
}

@Service()
export class TasksRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  listByWorkspace(workspaceId: string) {
    return this.db
      .selectFrom('tasks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .orderBy('createdAt', 'desc')
      .execute()
  }

  listByProject(projectId: string) {
    return this.db
      .selectFrom('tasks')
      .selectAll()
      .where('projectId', '=', projectId)
      .orderBy('orderIndex', 'asc')
      .execute()
  }

  findById(id: string) {
    return this.db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst()
  }

  // status / priority are defaulted in the schema, so the spread
  // is the natural insert shape — Generated columns (id, createdAt,
  // updatedAt) and explicit DB defaults can be omitted; the DB fills
  // them in. priority is a PG enum so the type narrows automatically.
  create(input: NewTask) {
    return this.db
      .insertInto('tasks')
      .values({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        key: input.key,
        title: input.title,
        reporterId: input.reporterId,
        description: input.description ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        estimatePoints: input.estimatePoints ?? null,
        parentTaskId: input.parentTaskId ?? null,
        dueDate: input.dueDate ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  updateStatus(id: string, status: string) {
    return this.db
      .updateTable('tasks')
      .set({ status, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
  }
}
