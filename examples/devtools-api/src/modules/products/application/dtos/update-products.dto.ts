import { z } from 'zod'

export const updateProductsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateProductsDTO = z.infer<typeof updateProductsSchema>
