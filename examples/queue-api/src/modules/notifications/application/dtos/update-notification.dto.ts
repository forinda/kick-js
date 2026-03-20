import { z } from 'zod'

export const updateNotificationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
})

export type UpdateNotificationDTO = z.infer<typeof updateNotificationSchema>
