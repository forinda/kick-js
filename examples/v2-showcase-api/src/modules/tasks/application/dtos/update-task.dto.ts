import { z } from 'zod'

export const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateTaskDTO = z.infer<typeof updateTaskSchema>
