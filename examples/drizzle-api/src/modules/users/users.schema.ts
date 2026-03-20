import { z } from 'zod'

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'editor']).optional().default('user'),
})

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user', 'editor']).optional(),
})
