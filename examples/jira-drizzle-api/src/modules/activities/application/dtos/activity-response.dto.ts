import type { activities } from '@/db/schema'

export type ActivityResponseDTO = typeof activities.$inferSelect
