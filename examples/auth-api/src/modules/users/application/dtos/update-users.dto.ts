import { z } from 'zod'

export const updateUsersSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateUsersDTO = z.infer<typeof updateUsersSchema>
