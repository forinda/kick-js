import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export type ChannelType = 'public' | 'private' | 'direct';

export interface ChannelEntity extends BaseEntity {
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  name: string;
  description?: string;
  type: ChannelType;
  memberIds: Types.ObjectId[];
  createdById: Types.ObjectId;
}
