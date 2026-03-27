import { Repository } from '@forinda/kickjs-core';
import mongoose from 'mongoose';
import type { IWorkspaceMemberRepository } from '../../domain/repositories/workspace-member.repository';
import type { WorkspaceMemberEntity } from '../../domain/entities/workspace-member.entity';
import { WorkspaceMemberModel } from '../schemas/workspace-member.schema';
import { buildMongoFilter, buildMongoSort } from '@/shared/infrastructure/database/query-helpers';

@Repository()
export class MongoWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  async findByUserAndWorkspace(userId: string, workspaceId: string): Promise<WorkspaceMemberEntity | null> {
    return WorkspaceMemberModel.findOne({ userId, workspaceId }).lean() as any;
  }

  async findByWorkspace(workspaceId: string): Promise<WorkspaceMemberEntity[]> {
    return WorkspaceMemberModel.find({ workspaceId }).lean() as any;
  }

  async findByUser(userId: string): Promise<WorkspaceMemberEntity[]> {
    return WorkspaceMemberModel.find({ userId }).lean() as any;
  }

  async create(data: Partial<WorkspaceMemberEntity>): Promise<WorkspaceMemberEntity> {
    const doc = await WorkspaceMemberModel.create(data);
    return doc.toObject() as any;
  }

  async updateRole(id: string, role: 'admin' | 'member'): Promise<WorkspaceMemberEntity | null> {
    return WorkspaceMemberModel.findByIdAndUpdate(id, { $set: { role } }, { new: true }).lean() as any;
  }

  async delete(id: string): Promise<boolean> {
    const result = await WorkspaceMemberModel.findByIdAndDelete(id);
    return !!result;
  }

  async deleteByUserAndWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const result = await WorkspaceMemberModel.deleteOne({ userId, workspaceId });
    return result.deletedCount > 0;
  }

  async findPaginatedForUser(parsed: any, userId: string): Promise<{ data: any[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;
    const matchStage = { userId: new mongoose.Types.ObjectId(userId), ...buildMongoFilter(filters) };
    const mongoSort = buildMongoSort(sort);

    const pipeline: any[] = [
      { $match: matchStage },
      { $lookup: { from: 'workspaces', localField: 'workspaceId', foreignField: '_id', as: 'workspace' } },
      { $unwind: '$workspace' },
      { $project: {
        _id: '$workspace._id',
        name: '$workspace.name',
        slug: '$workspace.slug',
        description: '$workspace.description',
        ownerId: '$workspace.ownerId',
        logoUrl: '$workspace.logoUrl',
        createdAt: '$workspace.createdAt',
        updatedAt: '$workspace.updatedAt',
        role: '$role',
      }},
      { $sort: mongoSort },
    ];

    const countPipeline = [...pipeline, { $count: 'total' }];
    const dataPipeline = [...pipeline, { $skip: pagination.offset }, { $limit: pagination.limit }];

    const [countResult, data] = await Promise.all([
      WorkspaceMemberModel.aggregate(countPipeline),
      WorkspaceMemberModel.aggregate(dataPipeline),
    ]);

    return { data, total: countResult[0]?.total ?? 0 };
  }

  async findPaginatedMembers(parsed: any, workspaceId: string): Promise<{ data: any[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 } } = parsed;
    const matchStage = { workspaceId: new mongoose.Types.ObjectId(workspaceId), ...buildMongoFilter(filters) };
    const mongoSort = buildMongoSort(sort);

    const pipeline: any[] = [
      { $match: matchStage },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: {
        _id: 1,
        userId: 1,
        role: 1,
        joinedAt: 1,
        user: {
          email: '$user.email',
          firstName: '$user.firstName',
          lastName: '$user.lastName',
          avatarUrl: '$user.avatarUrl',
        },
      }},
      { $sort: mongoSort },
    ];

    const countPipeline = [...pipeline, { $count: 'total' }];
    const dataPipeline = [...pipeline, { $skip: pagination.offset }, { $limit: pagination.limit }];

    const [countResult, data] = await Promise.all([
      WorkspaceMemberModel.aggregate(countPipeline),
      WorkspaceMemberModel.aggregate(dataPipeline),
    ]);

    return { data, total: countResult[0]?.total ?? 0 };
  }
}
