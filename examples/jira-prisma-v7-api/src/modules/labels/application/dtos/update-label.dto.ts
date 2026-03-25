import { z } from 'zod'

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex color code')
    .optional(),
})

export type UpdateLabelDTO = z.infer<typeof updateLabelSchema>
