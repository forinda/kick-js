import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

import type { Db } from '../../db/client'

export interface NewTask {
  workspaceId: string
  title: string
  description?: string | null
  status?: string
  priority?: string
  estimatePoints?: number | null
  metadata?: Record<string, unknown> | null
}

@Service()
export class TasksRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  private get typed(): Db {
    return this.db as Db
  }

  async listByWorkspace(workspaceId: string): Promise<unknown[]> {
    return this.typed
      .selectFrom('tasks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .orderBy('createdAt', 'desc')
      .execute()
  }

  async create(input: NewTask): Promise<unknown> {
    return this.typed
      .insertInto('tasks')
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'todo',
        priority: input.priority ?? 'none',
        estimatePoints: input.estimatePoints ?? null,
        metadata: input.metadata ?? null,
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async updateStatus(id: string, status: string): Promise<unknown | undefined> {
    return this.typed
      .updateTable('tasks')
      .set({ status } as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
  }
}
