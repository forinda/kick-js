import mongoose, { Schema, type Document } from 'mongoose';
import type { CommentEntity } from '../../domain/entities/comment.entity';

export interface CommentDocument extends Omit<CommentEntity, '_id'>, Document {}

const commentSchema = new Schema<CommentDocument>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
    isEdited: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const CommentModel = (mongoose.models.Comment as mongoose.Model<CommentDocument>) || mongoose.model<CommentDocument>('Comment', commentSchema);
