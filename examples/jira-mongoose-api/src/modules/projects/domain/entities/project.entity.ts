import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface StatusColumn {
  name: string;
  order: number;
  color: string;
}

export interface ProjectEntity extends BaseEntity {
  workspaceId: Types.ObjectId;
  name: string;
  key: string;
  description?: string;
  leadId?: Types.ObjectId;
  statusColumns: StatusColumn[];
  taskCounter: number;
  isArchived: boolean;
}
