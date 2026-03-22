import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  status: z.string().default('todo'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('none'),
  assigneeIds: z.array(z.string()).default([]),
  labelIds: z.array(z.string()).default([]),
  parentTaskId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  estimatePoints: z.number().int().min(0).optional(),
});

export type CreateTaskDto = z.infer<typeof createTaskSchema>;
