import { z } from 'zod'

export const updateOrdersSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateOrdersDTO = z.infer<typeof updateOrdersSchema>
