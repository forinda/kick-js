import { z } from 'zod';

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  labelIds: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  estimatePoints: z.number().int().min(0).nullable().optional(),
});

export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;
