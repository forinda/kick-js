import { z } from 'zod';

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

export type UpdateCommentDto = z.infer<typeof updateCommentSchema>;
