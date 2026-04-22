import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface CommentEntity extends BaseEntity {
  taskId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  mentions: Types.ObjectId[];
  parentCommentId?: Types.ObjectId;
  isEdited: boolean;
}
