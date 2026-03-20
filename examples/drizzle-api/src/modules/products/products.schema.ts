import { z } from 'zod'

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  stock: z.number().int().min(0).optional().default(0),
  category: z.string().min(1),
})

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
  category: z.string().min(1).optional(),
})
