import { z } from 'zod';

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
});

export type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;
