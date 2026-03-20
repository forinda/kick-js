import { z } from 'zod'

export const updateHealthSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateHealthDTO = z.infer<typeof updateHealthSchema>
