import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

export interface NewTask {
  workspaceId: string
  title: string
  description?: string | null
  status?: string
  priority?: string
  estimatePoints?: number | null
  metadata?: { tags?: string[]; customFields?: Record<string, string> } | null
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

  // status / priority / metadata are all defaulted or nullable in the schema,
  // so the spread is the natural insert shape — Generated columns (id,
  // createdAt) and explicit DB defaults (status='todo', priority='none')
  // can be omitted; the DB fills them in.
  create(input: NewTask) {
    return this.db
      .insertInto('tasks')
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        estimatePoints: input.estimatePoints ?? null,
        metadata: input.metadata ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  updateStatus(id: string, status: string) {
    return this.db
      .updateTable('tasks')
      .set({ status })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
  }
}
