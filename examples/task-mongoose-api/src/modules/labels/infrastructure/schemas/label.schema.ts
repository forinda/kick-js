import mongoose, { Schema, type Document } from 'mongoose';
import type { LabelEntity } from '../../domain/entities/label.entity';

export interface LabelDocument extends Omit<LabelEntity, '_id'>, Document {}

const labelSchema = new Schema<LabelDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, required: true },
  },
  { timestamps: true },
);

labelSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const LabelModel = (mongoose.models.Label as mongoose.Model<LabelDocument>) || mongoose.model<LabelDocument>('Label', labelSchema);
