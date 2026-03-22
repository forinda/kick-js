import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export type NotificationType = 'task_assigned' | 'mentioned' | 'comment_added' | 'task_status_changed' | 'due_date_reminder' | 'workspace_invite';

export interface NotificationEntity extends BaseEntity {
  recipientId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, any>;
  isRead: boolean;
}
