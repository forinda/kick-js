import { z } from 'zod'

/**
 * Demonstrates: query parameter validation with coercion.
 * Zod coerces string query params to their target types.
 * This schema is passed to @Get('/', { query: listUsersQuerySchema }).
 */
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['user', 'admin', 'moderator']).optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['username', 'email', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>
