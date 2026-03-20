import { z } from 'zod'

export const createProductsSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0).optional().default(0),
  category: z.string().min(1),
})

export type CreateProductsDTO = z.infer<typeof createProductsSchema>
