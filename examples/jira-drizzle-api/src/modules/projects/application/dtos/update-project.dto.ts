import { z } from 'zod'

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  isArchived: z.boolean().optional(),
  statusColumns: z
    .array(
      z.object({
        name: z.string(),
        order: z.number(),
        color: z.string(),
      }),
    )
    .optional(),
})

export type UpdateProjectDTO = z.infer<typeof updateProjectSchema>
