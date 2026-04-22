import { z } from 'zod'

export const updateCommentSchema = z.object({
  content: z.string().min(1),
})

export type UpdateCommentDTO = z.infer<typeof updateCommentSchema>
