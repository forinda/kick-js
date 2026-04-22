import type { CommentEntity } from '../entities/comment.entity';

export interface ICommentRepository {
  findById(id: string): Promise<CommentEntity | null>;
  findByTask(taskId: string): Promise<CommentEntity[]>;
  create(data: Partial<CommentEntity>): Promise<CommentEntity>;
  update(id: string, data: Partial<CommentEntity>): Promise<CommentEntity | null>;
  delete(id: string): Promise<boolean>;
}
