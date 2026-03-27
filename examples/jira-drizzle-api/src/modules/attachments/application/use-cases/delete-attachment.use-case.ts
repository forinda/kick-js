import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../../domain/repositories/attachment.repository'
import { tasks } from '@/db/schema'

@Service()
export class DeleteAttachmentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository,
    @Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase,
  ) {}

  async execute(id: string) {
    const attachment = await this.repo.findById(id)
    if (!attachment) return

    await this.repo.delete(id)

    // Decrement attachment count on task
    await this.db
      .update(tasks)
      .set({
        attachmentCount: sql`GREATEST(${tasks.attachmentCount} - 1, 0)`,
      })
      .where(eq(tasks.id, attachment.taskId))
  }
}
