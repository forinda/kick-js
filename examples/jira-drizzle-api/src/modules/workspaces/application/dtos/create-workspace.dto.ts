import { z } from 'zod'

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
})

export type CreateWorkspaceDTO = z.infer<typeof createWorkspaceSchema>
