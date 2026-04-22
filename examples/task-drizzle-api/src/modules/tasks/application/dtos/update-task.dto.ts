import { z } from 'zod'

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatePoints: z.number().int().nullable().optional(),
  orderIndex: z.number().int().optional(),
})

export type UpdateTaskDTO = z.infer<typeof updateTaskSchema>
