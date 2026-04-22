import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export type ActivityAction = 'task_created' | 'task_updated' | 'task_deleted' | 'comment_added' | 'status_changed' | 'assignee_changed' | 'member_joined' | 'member_left' | 'project_created' | 'workspace_created';

export interface ActivityEntity extends BaseEntity {
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  actorId: Types.ObjectId;
  action: ActivityAction;
  changes?: { field: string; from?: any; to?: any };
}
