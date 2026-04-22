import { z } from 'zod';

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  leadId: z.string().optional(),
});

export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
