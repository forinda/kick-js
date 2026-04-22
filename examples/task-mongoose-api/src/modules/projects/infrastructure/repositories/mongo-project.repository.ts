import { Repository } from '@forinda/kickjs';
import type { IProjectRepository } from '../../domain/repositories/project.repository';
import type { ProjectEntity } from '../../domain/entities/project.entity';
import { ProjectModel } from '../schemas/project.schema';
import { buildMongoFilter, buildMongoSort, buildMongoSearch } from '@/shared/infrastructure/database/query-helpers';

@Repository()
export class MongoProjectRepository implements IProjectRepository {
  async findPaginated(parsed: any, extraFilter: Record<string, any> = {}): Promise<{ data: any[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 }, search = '' } = parsed;
    const mongoFilter = { ...extraFilter, ...buildMongoFilter(filters), ...buildMongoSearch(search) };
    const mongoSort = buildMongoSort(sort);
    const [data, total] = await Promise.all([
      ProjectModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      ProjectModel.countDocuments(mongoFilter),
    ]);
    return { data: data as any[], total };
  }

  async findById(id: string): Promise<ProjectEntity | null> {
    return ProjectModel.findById(id).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<ProjectEntity[]> {
    return ProjectModel.find({ workspaceId, isArchived: false }).lean() as any;
  }

  async findByKeyAndWorkspace(key: string, workspaceId: string): Promise<ProjectEntity | null> {
    return ProjectModel.findOne({ key, workspaceId }).lean() as any;
  }

  async create(data: Partial<ProjectEntity>): Promise<ProjectEntity> {
    const doc = await ProjectModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<ProjectEntity>): Promise<ProjectEntity | null> {
    return ProjectModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await ProjectModel.findByIdAndUpdate(id, { $set: { isArchived: true } });
    return !!result;
  }

  async incrementTaskCounter(projectId: string): Promise<number> {
    const result = await ProjectModel.findByIdAndUpdate(
      projectId,
      { $inc: { taskCounter: 1 } },
      { new: true },
    );
    return result?.taskCounter ?? 0;
  }
}
