import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Channel name must be lowercase with hyphens'),
  description: z.string().max(500).optional(),
  type: z.enum(['public', 'private', 'direct']).default('public'),
  projectId: z.string().optional(),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;
