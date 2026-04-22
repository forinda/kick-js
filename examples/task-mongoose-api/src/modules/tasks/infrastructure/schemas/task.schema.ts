import mongoose, { Schema, type Document } from 'mongoose';
import type { TaskEntity } from '../../domain/entities/task.entity';

export interface TaskDocument extends Omit<TaskEntity, '_id'>, Document {}

const taskSchema = new Schema<TaskDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, default: 'todo' },
    priority: { type: String, enum: ['critical', 'high', 'medium', 'low', 'none'], default: 'none' },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labelIds: [{ type: Schema.Types.ObjectId, ref: 'Label' }],
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    dueDate: { type: Date },
    estimatePoints: { type: Number },
    orderIndex: { type: Number, default: 0 },
    attachmentCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeIds: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ title: 'text', description: 'text' });

export const TaskModel = (mongoose.models.Task as mongoose.Model<TaskDocument>) || mongoose.model<TaskDocument>('Task', taskSchema);
