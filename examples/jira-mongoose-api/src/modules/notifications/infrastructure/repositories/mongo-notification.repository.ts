import { Repository } from '@forinda/kickjs-core';
import type { INotificationRepository } from '../../domain/repositories/notification.repository';
import type { NotificationEntity } from '../../domain/entities/notification.entity';
import { buildMongoFilter, buildMongoSort } from '@/shared/infrastructure/database/query-helpers';
import { NotificationModel } from '../schemas/notification.schema';

@Repository()
export class MongoNotificationRepository implements INotificationRepository {
  async findById(id: string): Promise<NotificationEntity | null> {
    return NotificationModel.findById(id).lean() as any;
  }

  async findByRecipient(recipientId: string, parsed: any): Promise<{ data: NotificationEntity[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;

    const mongoFilter = {
      recipientId,
      ...buildMongoFilter(filters),
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      NotificationModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      NotificationModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }

  async create(data: Partial<NotificationEntity>): Promise<NotificationEntity> {
    const doc = await NotificationModel.create(data);
    return doc.toObject() as any;
  }

  async markAsRead(id: string) {
    await NotificationModel.findByIdAndUpdate(id, { $set: { isRead: true } });
  }

  async markAllAsRead(recipientId: string) {
    await NotificationModel.updateMany({ recipientId, isRead: false }, { $set: { isRead: true } });
  }

  async countUnread(recipientId: string): Promise<number> {
    return NotificationModel.countDocuments({ recipientId, isRead: false });
  }
}
