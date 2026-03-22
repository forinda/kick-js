import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface WorkspaceMemberEntity extends BaseEntity {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
}
