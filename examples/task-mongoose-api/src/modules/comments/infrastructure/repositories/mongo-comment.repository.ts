import { Repository } from '@forinda/kickjs';
import type { ICommentRepository } from '../../domain/repositories/comment.repository';
import type { CommentEntity } from '../../domain/entities/comment.entity';
import { CommentModel } from '../schemas/comment.schema';
import { buildMongoFilter, buildMongoSort, buildMongoSearch } from '@/shared/infrastructure/database/query-helpers';

@Repository()
export class MongoCommentRepository implements ICommentRepository {
  async findPaginated(parsed: any, extraFilter: Record<string, any> = {}): Promise<{ data: any[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 }, search = '' } = parsed;
    const mongoFilter = { ...extraFilter, ...buildMongoFilter(filters), ...buildMongoSearch(search) };
    const mongoSort = buildMongoSort(sort);
    const [data, total] = await Promise.all([
      CommentModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      CommentModel.countDocuments(mongoFilter),
    ]);
    return { data: data as any[], total };
  }

  async findById(id: string): Promise<CommentEntity | null> {
    return CommentModel.findById(id).lean() as any;
  }

  async findByTask(taskId: string): Promise<CommentEntity[]> {
    return CommentModel.find({ taskId }).sort({ createdAt: 1 }).lean() as any;
  }

  async create(data: Partial<CommentEntity>): Promise<CommentEntity> {
    const doc = await CommentModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<CommentEntity>): Promise<CommentEntity | null> {
    return CommentModel.findByIdAndUpdate(id, { $set: { ...data, isEdited: true } }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await CommentModel.findByIdAndDelete(id);
    return !!result;
  }
}
