import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface TaskEntity extends BaseEntity {
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  key: string;
  title: string;
  description?: string;
  status: string;
  priority: TaskPriority;
  assigneeIds: Types.ObjectId[];
  reporterId: Types.ObjectId;
  labelIds: Types.ObjectId[];
  parentTaskId?: Types.ObjectId;
  dueDate?: Date;
  estimatePoints?: number;
  orderIndex: number;
  attachmentCount: number;
  commentCount: number;
}
