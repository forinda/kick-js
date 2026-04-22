import { z } from 'zod';

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;
