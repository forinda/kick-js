export function generateCreateDTO(pascal: string, kebab: string): string {
  return `import { z } from 'zod'

/**
 * Create ${pascal} DTO — Zod schema for validating POST request bodies.
 * This schema is passed to @Post('/', { body: create${pascal}Schema }) for automatic validation.
 * It also generates OpenAPI request body docs when SwaggerAdapter is used.
 *
 * Add more fields as needed. Supported Zod types:
 *   z.string(), z.number(), z.boolean(), z.enum([...]),
 *   z.array(), z.object(), .optional(), .default(), .transform()
 */
export const create${pascal}Schema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
})

export type Create${pascal}DTO = z.infer<typeof create${pascal}Schema>
`
}

export function generateUpdateDTO(pascal: string, kebab: string): string {
  return `import { z } from 'zod'

export const update${pascal}Schema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type Update${pascal}DTO = z.infer<typeof update${pascal}Schema>
`
}

export function generateResponseDTO(pascal: string, kebab: string): string {
  return `export interface ${pascal}ResponseDTO {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
`
}
