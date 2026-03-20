import { z } from 'zod'

export const updateProductsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
  category: z.string().min(1).optional(),
})

export type UpdateProductsDTO = z.infer<typeof updateProductsSchema>
