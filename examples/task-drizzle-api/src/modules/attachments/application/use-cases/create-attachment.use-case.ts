import { Service, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
  type NewAttachment,
} from '../../domain/repositories/attachment.repository'
import { tasks } from '@/db/schema'

@Service()
export class CreateAttachmentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository,
    @Inject(DRIZZLE_DB) private readonly db: PostgresJsDatabase,
  ) {}

  async execute(data: Omit<NewAttachment, 'uploaderId'>, uploaderId: string) {
    const attachment = await this.repo.create({
      ...data,
      uploaderId,
    })

    // Increment attachment count on task
    await this.db
      .update(tasks)
      .set({ attachmentCount: sql`${tasks.attachmentCount} + 1` })
      .where(eq(tasks.id, data.taskId))

    return attachment
  }
}
