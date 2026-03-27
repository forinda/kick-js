import { Repository } from '@forinda/kickjs';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import { RefreshTokenModel } from '../schemas/refresh-token.schema';

@Repository()
export class MongoRefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { userId: string; token: string; expiresAt: Date }) {
    return RefreshTokenModel.create(data);
  }

  async findByToken(token: string) {
    return RefreshTokenModel.findOne({ token }).lean();
  }

  async deleteByToken(token: string) {
    const result = await RefreshTokenModel.deleteOne({ token });
    return result.deletedCount > 0;
  }

  async deleteByUserId(userId: string) {
    await RefreshTokenModel.deleteMany({ userId });
  }

  async deleteExpired() {
    const result = await RefreshTokenModel.deleteMany({ expiresAt: { $lt: new Date() } });
    return result.deletedCount;
  }
}
