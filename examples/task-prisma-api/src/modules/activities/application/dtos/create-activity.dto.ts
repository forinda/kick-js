import { z } from 'zod'

export const createActivitySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  action: z.string().min(1).max(100),
  changes: z.record(z.string(), z.unknown()).optional(),
})

export type CreateActivityDTO = z.infer<typeof createActivitySchema>
