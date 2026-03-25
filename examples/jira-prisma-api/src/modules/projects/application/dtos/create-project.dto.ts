import { z } from 'zod'

export const createProjectSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  key: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z]+$/, 'Key must be uppercase letters'),
  description: z.string().optional(),
  leadId: z.string().uuid().optional(),
})

export type CreateProjectDTO = z.infer<typeof createProjectSchema>
