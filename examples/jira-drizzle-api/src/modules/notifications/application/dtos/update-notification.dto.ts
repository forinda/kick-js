import { z } from 'zod'

export const updateNotificationSchema = z.object({
  isRead: z.boolean(),
})

export type UpdateNotificationDTO = z.infer<typeof updateNotificationSchema>
