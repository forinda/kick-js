import { z } from 'zod';

export const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color'),
});

export type CreateLabelDto = z.infer<typeof createLabelSchema>;
