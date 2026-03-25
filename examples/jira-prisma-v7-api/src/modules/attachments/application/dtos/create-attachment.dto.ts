import { z } from 'zod'

// taskId comes from the request body (multipart form field)
export const createAttachmentSchema = z.object({
  taskId: z.string().uuid(),
})

export type CreateAttachmentDTO = z.infer<typeof createAttachmentSchema>
