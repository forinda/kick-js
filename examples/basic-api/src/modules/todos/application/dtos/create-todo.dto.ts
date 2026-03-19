import { z } from 'zod'

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
})

export type CreateTodoDTO = z.infer<typeof createTodoSchema>
