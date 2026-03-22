import { z } from 'zod';

export const reorderTaskSchema = z.object({
  status: z.string().min(1),
  orderIndex: z.number().int().min(0),
});

export type ReorderTaskDto = z.infer<typeof reorderTaskSchema>;
