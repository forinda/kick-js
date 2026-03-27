import { Service, Inject, HttpException } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IUserRepository } from '../../domain/repositories/user.repository';
import type { UpdateProfileDto } from '../dtos/update-profile.dto';

@Service()
export class UpdateProfileUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async execute(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.update(userId, dto);
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
    };
  }
}
