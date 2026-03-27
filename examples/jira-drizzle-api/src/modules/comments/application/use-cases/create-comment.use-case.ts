import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'
import type { CreateCommentDTO } from '../dtos/create-comment.dto'
import { tasks } from '@/db/schema'

/** Extract @mentioned user IDs from comment content */
function parseMentions(content: string): string[] {
  const uuidRegex = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  const matches = content.matchAll(uuidRegex)
  return [...new Set([...matches].map((m) => m[1]))]
}

@Service()
export class CreateCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository,
    @Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase,
  ) {}

  async execute(dto: CreateCommentDTO, authorId: string) {
    const mentions = parseMentions(dto.content)

    const comment = await this.repo.create({
      taskId: dto.taskId,
      authorId,
      content: dto.content,
      mentions,
    })

    // Increment comment count on task
    await this.db
      .update(tasks)
      .set({ commentCount: sql`${tasks.commentCount} + 1` })
      .where(eq(tasks.id, dto.taskId))

    return comment
  }
}
