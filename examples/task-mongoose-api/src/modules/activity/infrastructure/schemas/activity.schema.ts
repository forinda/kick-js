import mongoose, { Schema, type Document } from 'mongoose';
import type { ActivityEntity } from '../../domain/entities/activity.entity';

export interface ActivityDocument extends Omit<ActivityEntity, '_id'>, Document {}

const activitySchema = new Schema<ActivityDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['task_created', 'task_updated', 'task_deleted', 'comment_added', 'status_changed', 'assignee_changed', 'member_joined', 'member_left', 'project_created', 'workspace_created'], required: true },
    changes: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

activitySchema.index({ workspaceId: 1, createdAt: -1 });
activitySchema.index({ projectId: 1, createdAt: -1 });

export const ActivityModel = (mongoose.models.Activity as mongoose.Model<ActivityDocument>) || mongoose.model<ActivityDocument>('Activity', activitySchema);
