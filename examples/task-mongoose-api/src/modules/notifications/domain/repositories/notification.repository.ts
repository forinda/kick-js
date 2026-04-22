import type { NotificationEntity } from '../entities/notification.entity';

export interface INotificationRepository {
  findById(id: string): Promise<NotificationEntity | null>;
  findByRecipient(recipientId: string, parsed: any): Promise<{ data: NotificationEntity[]; total: number }>;
  create(data: Partial<NotificationEntity>): Promise<NotificationEntity>;
  markAsRead(id: string): Promise<void>;
  markAllAsRead(recipientId: string): Promise<void>;
  countUnread(recipientId: string): Promise<number>;
}
