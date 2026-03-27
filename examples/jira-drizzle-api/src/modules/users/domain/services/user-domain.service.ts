import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { IUserRepository, User } from '../repositories/user.repository'

@Service()
export class UserDomainService {
  constructor(@Inject(TOKENS.USER_REPOSITORY) private readonly repo: IUserRepository) {}

  async ensureExists(id: string): Promise<User> {
    const user = await this.repo.findById(id)
    if (!user) {
      throw HttpException.notFound(ErrorCode.USER_NOT_FOUND)
    }
    return user
  }

  async ensureActive(id: string): Promise<User> {
    const user = await this.ensureExists(id)
    if (!user.isActive) {
      throw HttpException.forbidden(ErrorCode.USER_INACTIVE)
    }
    return user
  }
}
