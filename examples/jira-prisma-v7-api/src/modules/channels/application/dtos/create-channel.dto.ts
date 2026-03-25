import { z } from 'zod'

export const createChannelSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(['public', 'private', 'direct']).default('public'),
})

export type CreateChannelDTO = z.infer<typeof createChannelSchema>
