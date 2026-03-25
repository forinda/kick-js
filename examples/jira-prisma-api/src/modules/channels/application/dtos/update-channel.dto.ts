import { z } from 'zod'

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
})

export type UpdateChannelDTO = z.infer<typeof updateChannelSchema>
