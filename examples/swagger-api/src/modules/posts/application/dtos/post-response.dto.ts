import { z } from 'zod'

export const postResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  content: z.string(),
  excerpt: z.string().nullable(),
  status: z.enum(['draft', 'published', 'archived', 'scheduled']),
  publishAt: z.string().nullable(),
  media: z.array(z.object({
    url: z.string(),
    alt: z.string().nullable(),
    type: z.enum(['image', 'video', 'embed']),
  })),
  metadata: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  featured: z.boolean(),
  commentsEnabled: z.boolean(),
  author: z.object({
    id: z.string().uuid(),
    username: z.string(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PostResponseDTO = z.infer<typeof postResponseSchema>
