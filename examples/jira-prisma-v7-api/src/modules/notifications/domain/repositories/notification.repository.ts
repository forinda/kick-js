import type { ParsedQuery } from '@forinda/kickjs'
import type { Notification } from '@/generated/prisma/client'

export type { Notification }
export type NewNotification = {
  recipientId: string
  type: any
  title: string
  body: string
  metadata?: any
}

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
