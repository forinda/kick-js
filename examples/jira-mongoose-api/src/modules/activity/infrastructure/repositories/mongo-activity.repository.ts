import { Repository } from '@forinda/kickjs-core';
import type { IActivityRepository } from '../../domain/repositories/activity.repository';
import type { ActivityEntity } from '../../domain/entities/activity.entity';
import { buildMongoFilter, buildMongoSort } from '@/shared/infrastructure/database/query-helpers';
import { ActivityModel } from '../schemas/activity.schema';

@Repository()
export class MongoActivityRepository implements IActivityRepository {
  async create(data: Partial<ActivityEntity>): Promise<ActivityEntity> {
    const doc = await ActivityModel.create(data);
    return doc.toObject() as any;
  }

  async findByWorkspace(workspaceId: string, parsed: any): Promise<{ data: ActivityEntity[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;

    const mongoFilter = {
      workspaceId,
      ...buildMongoFilter(filters),
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      ActivityModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      ActivityModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }

  async findByProject(projectId: string, parsed: any): Promise<{ data: ActivityEntity[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;

    const mongoFilter = {
      projectId,
      ...buildMongoFilter(filters),
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      ActivityModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      ActivityModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }

  async findByTask(taskId: string): Promise<ActivityEntity[]> {
    return ActivityModel.find({ taskId }).sort({ createdAt: -1 }).lean() as any;
  }
}
