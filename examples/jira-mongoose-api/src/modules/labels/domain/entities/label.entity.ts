import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface LabelEntity extends BaseEntity {
  workspaceId: Types.ObjectId;
  name: string;
  color: string;
}
