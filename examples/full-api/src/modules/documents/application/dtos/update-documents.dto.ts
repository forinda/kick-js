import { z } from 'zod'

export const updateDocumentsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateDocumentsDTO = z.infer<typeof updateDocumentsSchema>
