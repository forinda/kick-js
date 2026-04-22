import { Service, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'
import { tasks } from '@/db/schema'

@Service()
export class DeleteCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository,
    @Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase,
  ) {}

  async execute(id: string) {
    const comment = await this.repo.findById(id)
    if (!comment) return

    await this.repo.delete(id)

    // Decrement comment count on task
    await this.db
      .update(tasks)
      .set({ commentCount: sql`GREATEST(${tasks.commentCount} - 1, 0)` })
      .where(eq(tasks.id, comment.taskId))
  }
}
