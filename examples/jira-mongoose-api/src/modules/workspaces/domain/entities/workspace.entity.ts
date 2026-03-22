import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface WorkspaceEntity extends BaseEntity {
  name: string;
  slug: string;
  description?: string;
  ownerId: Types.ObjectId;
  logoUrl?: string;
}
