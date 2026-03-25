import { z } from 'zod'

export const createUserSchema = z.object({
  email: z.string().email(),
  passwordHash: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  avatarUrl: z.string().optional(),
  globalRole: z.enum(['superadmin', 'user']).default('user'),
})

export type CreateUserDTO = z.infer<typeof createUserSchema>
