import { z } from 'zod'

/**
 * Demonstrates: string constraints, email, enum, number, boolean,
 * optional fields, defaults, regex, arrays, nested objects.
 * All of these translate into rich OpenAPI schema definitions.
 */
export const createUserSchema = z.object({
  // String with min/max length
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),

  // Email validation
  email: z.string().email('Invalid email address'),

  // Password with regex pattern
  password: z.string().min(8).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain uppercase, lowercase, and number',
  ),

  // Enum field
  role: z.enum(['user', 'admin', 'moderator']),

  // Optional string
  displayName: z.string().max(100).optional(),

  // Number with constraints
  age: z.number().int().min(13).max(150).optional(),

  // Boolean with default
  acceptTerms: z.boolean(),

  // Nested object
  profile: z.object({
    bio: z.string().max(500).optional(),
    website: z.string().url().optional(),
    location: z.string().max(100).optional(),
  }).optional(),

  // Array of strings
  tags: z.array(z.string().min(1).max(30)).max(10).optional(),
})

export type CreateUserDTO = z.infer<typeof createUserSchema>
