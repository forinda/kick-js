import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface UserEntity extends BaseEntity {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  globalRole: 'superadmin' | 'user';
  isActive: boolean;
  lastLoginAt?: Date;
}
