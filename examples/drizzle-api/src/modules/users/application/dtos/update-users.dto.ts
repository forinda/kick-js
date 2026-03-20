import { z } from 'zod'

export const updateUsersSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user', 'editor']).optional(),
})

export type UpdateUsersDTO = z.infer<typeof updateUsersSchema>
