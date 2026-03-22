import mongoose, { Schema, type Document } from 'mongoose';
import type { RefreshTokenEntity } from '../../domain/entities/refresh-token.entity';

export interface RefreshTokenDocument extends Omit<RefreshTokenEntity, '_id'>, Document {}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export const RefreshTokenModel = (mongoose.models.RefreshToken as mongoose.Model<RefreshTokenDocument>) || mongoose.model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
