import type { channels } from '@/db/schema'

export type ChannelResponseDTO = typeof channels.$inferSelect
