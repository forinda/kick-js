import { z } from 'zod'

export const createUsersSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'editor']).optional().default('user'),
})

export type CreateUsersDTO = z.infer<typeof createUsersSchema>
