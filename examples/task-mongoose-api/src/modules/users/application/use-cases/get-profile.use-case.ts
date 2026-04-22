import { Service, Inject, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IUserRepository } from '../../domain/repositories/user.repository';

@Service()
export class GetProfileUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async execute(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw HttpException.notFound(ErrorCode.USER_NOT_FOUND);
    }

    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      globalRole: user.globalRole,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
