import type { notifications } from '@/db/schema'

export type NotificationResponseDTO = typeof notifications.$inferSelect
