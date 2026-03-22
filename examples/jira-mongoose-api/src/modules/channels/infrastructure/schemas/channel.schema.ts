import mongoose, { Schema, type Document } from 'mongoose';
import type { ChannelEntity } from '../../domain/entities/channel.entity';

export interface ChannelDocument extends Omit<ChannelEntity, '_id'>, Document {}

const channelSchema = new Schema<ChannelDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: { type: String, enum: ['public', 'private', 'direct'], default: 'public' },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

channelSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const ChannelModel = (mongoose.models.Channel as mongoose.Model<ChannelDocument>) || mongoose.model<ChannelDocument>('Channel', channelSchema);
