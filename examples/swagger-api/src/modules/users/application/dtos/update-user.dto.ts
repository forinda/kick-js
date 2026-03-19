import { z } from 'zod'
import { createUserSchema } from './create-user.dto'

/**
 * Demonstrates: .partial() to make all fields optional,
 * .omit() to exclude fields that shouldn't be updated.
 */
export const updateUserSchema = createUserSchema
  .omit({ password: true, acceptTerms: true })
  .partial()

export type UpdateUserDTO = z.infer<typeof updateUserSchema>
