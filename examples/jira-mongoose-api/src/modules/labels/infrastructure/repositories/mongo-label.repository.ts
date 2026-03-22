import { Repository } from '@forinda/kickjs-core';
import type { ILabelRepository } from '../../domain/repositories/label.repository';
import type { LabelEntity } from '../../domain/entities/label.entity';
import { LabelModel } from '../schemas/label.schema';
import { buildMongoFilter, buildMongoSort, buildMongoSearch } from '@/shared/infrastructure/database/query-helpers';

@Repository()
export class MongoLabelRepository implements ILabelRepository {
  async findPaginated(parsed: any, extraFilter: Record<string, any> = {}): Promise<{ data: any[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 }, search = '' } = parsed;
    const mongoFilter = { ...extraFilter, ...buildMongoFilter(filters), ...buildMongoSearch(search) };
    const mongoSort = buildMongoSort(sort);
    const [data, total] = await Promise.all([
      LabelModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      LabelModel.countDocuments(mongoFilter),
    ]);
    return { data: data as any[], total };
  }

  async findById(id: string): Promise<LabelEntity | null> {
    return LabelModel.findById(id).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<LabelEntity[]> {
    return LabelModel.find({ workspaceId }).sort({ name: 1 }).lean() as any;
  }

  async findByNameAndWorkspace(name: string, workspaceId: string): Promise<LabelEntity | null> {
    return LabelModel.findOne({ name, workspaceId }).lean() as any;
  }

  async create(data: Partial<LabelEntity>): Promise<LabelEntity> {
    const doc = await LabelModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<LabelEntity>): Promise<LabelEntity | null> {
    return LabelModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await LabelModel.findByIdAndDelete(id);
    return !!result;
  }
}
