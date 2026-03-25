import { z } from 'zod'

// Attachments are immutable — no update DTO needed
export const updateAttachmentSchema = z.object({})

export type UpdateAttachmentDTO = z.infer<typeof updateAttachmentSchema>
