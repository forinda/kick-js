import mongoose, { Schema, type Document } from 'mongoose';
import type { WorkspaceMemberEntity } from '../../domain/entities/workspace-member.entity';

export interface WorkspaceMemberDocument extends Omit<WorkspaceMemberEntity, '_id'>, Document {}

const workspaceMemberSchema = new Schema<WorkspaceMemberDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMemberModel = (mongoose.models.WorkspaceMember as mongoose.Model<WorkspaceMemberDocument>) || mongoose.model<WorkspaceMemberDocument>('WorkspaceMember', workspaceMemberSchema);
