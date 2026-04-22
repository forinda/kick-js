import type { Types } from 'mongoose';
import type { BaseEntity } from '@/shared/domain/base.entity';

export interface AttachmentEntity extends BaseEntity {
  taskId: Types.ObjectId;
  uploadedById: Types.ObjectId;
  fileName: string;
  fileSize: number;
  mimeType: string;
  base64Data: string;
}
