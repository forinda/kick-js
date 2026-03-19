import { z } from 'zod'
import { ProductStatus, ProductCategory } from './create-products.dto'

export const updateProductsSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(200, 'Name must be 200 characters or fewer')
    .optional(),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer')
    .optional(),
  price: z
    .number()
    .positive('Price must be a positive number')
    .multipleOf(0.01, 'Price must have at most 2 decimal places')
    .optional(),
  category: ProductCategory.optional(),
  status: ProductStatus.optional(),
  tags: z
    .array(z.string().min(1).max(50))
    .max(10, 'A product can have at most 10 tags')
    .optional(),
  sku: z
    .string()
    .regex(/^[A-Z0-9-]+$/, 'SKU must contain only uppercase letters, digits, and hyphens')
    .min(3)
    .max(30)
    .optional(),
  stock: z
    .number()
    .int('Stock must be a whole number')
    .nonnegative('Stock cannot be negative')
    .optional(),
})

export type UpdateProductsDTO = z.infer<typeof updateProductsSchema>
