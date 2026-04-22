import mongoose, { Schema, type Document } from 'mongoose';
import type { NotificationEntity } from '../../domain/entities/notification.entity';

export interface NotificationDocument extends Omit<NotificationEntity, '_id'>, Document {}

const notificationSchema = new Schema<NotificationDocument>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['task_assigned', 'mentioned', 'comment_added', 'task_status_changed', 'due_date_reminder', 'workspace_invite'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

export const NotificationModel = (mongoose.models.Notification as mongoose.Model<NotificationDocument>) || mongoose.model<NotificationDocument>('Notification', notificationSchema);
