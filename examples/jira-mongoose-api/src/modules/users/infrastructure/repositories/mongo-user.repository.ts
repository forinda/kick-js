import { Repository } from '@forinda/kickjs-core';
import type { IUserRepository } from '../../domain/repositories/user.repository';
import type { UserEntity } from '../../domain/entities/user.entity';
import { buildMongoFilter, buildMongoSort, buildMongoSearch } from '@/shared/infrastructure/database/query-helpers';
import { UserModel } from '../schemas/user.schema';

@Repository()
export class MongoUserRepository implements IUserRepository {
  async findById(id: string): Promise<UserEntity | null> {
    return UserModel.findById(id).lean() as any;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return UserModel.findOne({ email: email.toLowerCase() }).lean() as any;
  }

  async create(data: Partial<UserEntity>): Promise<UserEntity> {
    const doc = await UserModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<UserEntity>): Promise<UserEntity | null> {
    return UserModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as any;
  }

  async findPaginated(parsed: any): Promise<{ data: UserEntity[]; total: number }> {
    const { filters = [], sort = [], pagination = { page: 1, limit: 20, offset: 0 }, search = '' } = parsed;

    const mongoFilter = {
      ...buildMongoFilter(filters),
      ...buildMongoSearch(search),
    };
    const mongoSort = buildMongoSort(sort);

    const [data, total] = await Promise.all([
      UserModel.find(mongoFilter).sort(mongoSort).skip(pagination.offset).limit(pagination.limit).lean(),
      UserModel.countDocuments(mongoFilter),
    ]);

    return { data: data as any[], total };
  }
}
