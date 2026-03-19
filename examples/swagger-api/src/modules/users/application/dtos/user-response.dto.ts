import { z } from 'zod'

/**
 * Demonstrates: response schema for @ApiResponse({ schema: userResponseSchema }).
 * Zod schemas used in @ApiResponse automatically generate OpenAPI response definitions.
 */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  role: z.enum(['user', 'admin', 'moderator']),
  displayName: z.string().nullable(),
  age: z.number().nullable(),
  profile: z.object({
    bio: z.string().nullable(),
    website: z.string().nullable(),
    location: z.string().nullable(),
  }).nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type UserResponseDTO = z.infer<typeof userResponseSchema>

/**
 * Paginated response wrapper — demonstrates nested schemas in Swagger.
 */
export const paginatedUsersSchema = z.object({
  data: z.array(userResponseSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
})

export type PaginatedUsersDTO = z.infer<typeof paginatedUsersSchema>
