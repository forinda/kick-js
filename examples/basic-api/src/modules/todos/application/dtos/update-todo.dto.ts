import { z } from 'zod'

export const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
})

export type UpdateTodoDTO = z.infer<typeof updateTodoSchema>
