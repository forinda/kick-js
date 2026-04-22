import mongoose, { Schema, type Document } from 'mongoose';
import type { AttachmentEntity } from '../../domain/entities/attachment.entity';

export interface AttachmentDocument extends Omit<AttachmentEntity, '_id'>, Document {}

const attachmentSchema = new Schema<AttachmentDocument>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    base64Data: { type: String, required: true },
  },
  { timestamps: true },
);

export const AttachmentModel = (mongoose.models.Attachment as mongoose.Model<AttachmentDocument>) || mongoose.model<AttachmentDocument>('Attachment', attachmentSchema);
