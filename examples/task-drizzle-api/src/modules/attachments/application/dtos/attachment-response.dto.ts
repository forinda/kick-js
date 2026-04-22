import type { attachments } from '@/db/schema'

export type AttachmentResponseDTO = typeof attachments.$inferSelect
