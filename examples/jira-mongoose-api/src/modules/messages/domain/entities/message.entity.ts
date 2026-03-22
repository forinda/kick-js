import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface MessageEntity extends BaseEntity {
  channelId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
  mentions: Types.ObjectId[];
  isEdited: boolean;
  isDeleted: boolean;
}
