import { z } from 'zod'

export const updateMessageSchema = z.object({
  content: z.string().min(1),
})

export type UpdateMessageDTO = z.infer<typeof updateMessageSchema>
