import { z } from 'zod'

export const createLabelSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex color code'),
})

export type CreateLabelDTO = z.infer<typeof createLabelSchema>
