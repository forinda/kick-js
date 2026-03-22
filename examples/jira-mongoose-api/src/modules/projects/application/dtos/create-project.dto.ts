import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  key: z.string().min(2).max(10).regex(/^[A-Z][A-Z0-9]*$/, 'Key must be uppercase letters/numbers, starting with a letter'),
  description: z.string().max(500).optional(),
  leadId: z.string().optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;
