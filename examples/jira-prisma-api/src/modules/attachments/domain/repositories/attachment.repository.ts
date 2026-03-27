import type { ParsedQuery } from '@forinda/kickjs'
import type { Attachment } from '@prisma/client'

export type { Attachment }
export type NewAttachment = {
  taskId: string
  uploaderId: string
  fileName: string
  fileSize: number
  mimeType: string
  data: string
}

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
