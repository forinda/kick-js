import { z } from 'zod';

export const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type UpdateLabelDto = z.infer<typeof updateLabelSchema>;
