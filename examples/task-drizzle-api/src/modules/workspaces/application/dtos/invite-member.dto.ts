import { z } from 'zod'

export const inviteMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'member']).default('member'),
})

export type InviteMemberDTO = z.infer<typeof inviteMemberSchema>
