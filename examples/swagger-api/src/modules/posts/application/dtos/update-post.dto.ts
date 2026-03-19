import { z } from 'zod'

export const updatePostSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdatePostDTO = z.infer<typeof updatePostSchema>
