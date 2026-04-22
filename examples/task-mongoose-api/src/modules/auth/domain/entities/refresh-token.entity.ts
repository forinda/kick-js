import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface RefreshTokenEntity extends BaseEntity {
  userId: Types.ObjectId;
  token: string;
  expiresAt: Date;
}
