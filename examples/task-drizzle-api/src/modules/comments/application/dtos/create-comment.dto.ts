import { z } from 'zod'

export const createCommentSchema = z.object({
  taskId: z.string().uuid(),
  content: z.string().min(1),
})

export type CreateCommentDTO = z.infer<typeof createCommentSchema>
