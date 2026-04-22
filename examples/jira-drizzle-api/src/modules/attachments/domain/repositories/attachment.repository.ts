import type { attachments } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs'

export type Attachment = typeof attachments.$inferSelect
export type NewAttachment = typeof attachments.$inferInsert

export interface IAttachmentRepository {
  findById(id: string): Promise<Attachment | null>
  findByTask(taskId: string): Promise<Attachment[]>
  findPaginated(
    parsed: ParsedQuery,
    taskId?: string,
  ): Promise<{ data: Attachment[]; total: number }>
  create(data: NewAttachment): Promise<Attachment>
  delete(id: string): Promise<void>
}

export const ATTACHMENT_REPOSITORY = Symbol('IAttachmentRepository')
