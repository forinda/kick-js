import type { notifications } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs-http'

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

export interface INotificationRepository {
  findById(id: string): Promise<Notification | null>
  findPaginated(
    parsed: ParsedQuery,
    recipientId: string,
  ): Promise<{ data: Notification[]; total: number }>
  create(data: NewNotification): Promise<Notification>
  markRead(id: string): Promise<void>
  markAllRead(recipientId: string): Promise<void>
  unreadCount(recipientId: string): Promise<number>
  delete(id: string): Promise<void>
}

export const NOTIFICATION_REPOSITORY = Symbol('INotificationRepository')
