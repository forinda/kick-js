import type { comments } from '@/db/schema'

export type CommentResponseDTO = typeof comments.$inferSelect
