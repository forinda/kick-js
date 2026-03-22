import type { messages } from '@/db/schema'

export type MessageResponseDTO = typeof messages.$inferSelect
