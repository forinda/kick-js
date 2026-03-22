import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
});

export type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;
