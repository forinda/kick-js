import { Repository } from '@forinda/kickjs';
import type { IWorkspaceRepository } from '../../domain/repositories/workspace.repository';
import type { WorkspaceEntity } from '../../domain/entities/workspace.entity';
import { WorkspaceModel } from '../schemas/workspace.schema';

@Repository()
export class MongoWorkspaceRepository implements IWorkspaceRepository {
  async findById(id: string): Promise<WorkspaceEntity | null> {
    return WorkspaceModel.findById(id).lean() as any;
  }

  async findBySlug(slug: string): Promise<WorkspaceEntity | null> {
    return WorkspaceModel.findOne({ slug }).lean() as any;
  }

  async create(data: Partial<WorkspaceEntity>): Promise<WorkspaceEntity> {
    const doc = await WorkspaceModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<WorkspaceEntity>): Promise<WorkspaceEntity | null> {
    return WorkspaceModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await WorkspaceModel.findByIdAndDelete(id);
    return !!result;
  }

  async findByOwner(ownerId: string): Promise<WorkspaceEntity[]> {
    return WorkspaceModel.find({ ownerId }).lean() as any;
  }
}
