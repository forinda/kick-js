import { z } from 'zod'

export const createUsersSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export type CreateUsersDTO = z.infer<typeof createUsersSchema>
