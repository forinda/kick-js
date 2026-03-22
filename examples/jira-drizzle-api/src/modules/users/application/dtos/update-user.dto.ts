import { z } from 'zod'

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  lastLoginAt: z.coerce.date().optional(),
})

export type UpdateUserDTO = z.infer<typeof updateUserSchema>
