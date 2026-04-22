import { z } from 'zod';
import { paginationSchema } from '@/shared/application/pagination.dto';

export const taskFilterSchema = paginationSchema.extend({
  status: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  assigneeId: z.string().optional(),
  labelId: z.string().optional(),
});

export type TaskFilterDto = z.infer<typeof taskFilterSchema>;
