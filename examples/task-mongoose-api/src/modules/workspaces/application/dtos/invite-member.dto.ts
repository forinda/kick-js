import { z } from 'zod';

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
