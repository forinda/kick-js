import { z } from 'zod'

export const createMessageSchema = z.object({
  channelId: z.string().uuid(),
  content: z.string().min(1),
})

export type CreateMessageDTO = z.infer<typeof createMessageSchema>
