import type { AttachmentEntity } from '../entities/attachment.entity';

export interface IAttachmentRepository {
  findById(id: string): Promise<AttachmentEntity | null>;
  findByTask(taskId: string): Promise<AttachmentEntity[]>;
  create(data: Partial<AttachmentEntity>): Promise<AttachmentEntity>;
  delete(id: string): Promise<boolean>;
}
