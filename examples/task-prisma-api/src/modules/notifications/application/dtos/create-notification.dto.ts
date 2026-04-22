import { z } from 'zod'

export const createNotificationSchema = z.object({
  recipientId: z.string().uuid(),
  type: z.enum(['task_assigned', 'mentioned', 'workspace_invite', 'task_overdue', 'comment_added']),
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type CreateNotificationDTO = z.infer<typeof createNotificationSchema>
