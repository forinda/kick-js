import mongoose, { Schema, type Document } from 'mongoose';
import type { ProjectEntity } from '../../domain/entities/project.entity';

export interface ProjectDocument extends Omit<ProjectEntity, '_id'>, Document {}

const statusColumnSchema = new Schema(
  {
    name: { type: String, required: true },
    order: { type: Number, required: true },
    color: { type: String, required: true },
  },
  { _id: false },
);

const projectSchema = new Schema<ProjectDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'User' },
    statusColumns: {
      type: [statusColumnSchema],
      default: [
        { name: 'todo', order: 0, color: '#94a3b8' },
        { name: 'in-progress', order: 1, color: '#3b82f6' },
        { name: 'review', order: 2, color: '#f59e0b' },
        { name: 'done', order: 3, color: '#22c55e' },
      ],
    },
    taskCounter: { type: Number, default: 0 },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

projectSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const ProjectModel = (mongoose.models.Project as mongoose.Model<ProjectDocument>) || mongoose.model<ProjectDocument>('Project', projectSchema);
