import { z } from 'zod'

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
})

export type UpdateMemberRoleDTO = z.infer<typeof updateMemberRoleSchema>
