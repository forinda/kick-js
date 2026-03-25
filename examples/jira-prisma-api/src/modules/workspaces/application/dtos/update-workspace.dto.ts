import { z } from 'zod'

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
})

export type UpdateWorkspaceDTO = z.infer<typeof updateWorkspaceSchema>
