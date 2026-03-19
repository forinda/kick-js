import { z } from 'zod'

export const createDocumentsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
})

export type CreateDocumentsDTO = z.infer<typeof createDocumentsSchema>
