import { z } from 'zod'

/**
 * Create Task DTO — Zod schema for validating POST request bodies.
 * This schema is passed to @Post('/', { body: createTaskSchema }) for automatic validation.
 * It also generates OpenAPI request body docs when SwaggerAdapter is used.
 *
 * Add more fields as needed. Supported Zod types:
 *   z.string(), z.number(), z.boolean(), z.enum([...]),
 *   z.array(), z.object(), .optional(), .default(), .transform()
 */
export const createTaskSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
})

export type CreateTaskDTO = z.infer<typeof createTaskSchema>
