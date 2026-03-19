import { z } from 'zod'

/**
 * Demonstrates: discriminated union, literal types, date strings,
 * record types, tuple, and refined validations.
 */

// Reusable schema fragments
const slugSchema = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format')

const mediaSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(200).optional(),
  type: z.enum(['image', 'video', 'embed']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const createPostSchema = z.object({
  // Basic string
  title: z.string().min(1, 'Title is required').max(300),

  // Regex-validated slug
  slug: slugSchema.optional(),

  // Long-form content
  content: z.string().min(1, 'Content is required').max(50_000),

  // Rich text excerpt with length limit
  excerpt: z.string().max(500).optional(),

  // Enum status
  status: z.enum(['draft', 'published', 'archived', 'scheduled']).default('draft'),

  // ISO date string for scheduled publishing
  publishAt: z.string().datetime({ message: 'Must be ISO 8601 datetime' }).optional(),

  // Nested array of objects
  media: z.array(mediaSchema).max(20).optional(),

  // Record type (string keys, string values)
  metadata: z.record(z.string(), z.string()).optional(),

  // Array of UUIDs (related post IDs)
  relatedPostIds: z.array(z.string().uuid()).max(5).optional(),

  // Category ID reference
  categoryId: z.string().uuid().optional(),

  // Tags as string array
  tags: z.array(z.string().min(1).max(50)).max(15).optional(),

  // Boolean flags
  featured: z.boolean().default(false),
  commentsEnabled: z.boolean().default(true),
})

export type CreatePostDTO = z.infer<typeof createPostSchema>
