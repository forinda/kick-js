import { z } from 'zod'

export const updateCatSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateCatDTO = z.infer<typeof updateCatSchema>
