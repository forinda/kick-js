import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { USERS_REPOSITORY, type IUsersRepository } from '../repositories/users.repository'

@Service()
export class UsersDomainService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Users not found')
    }
  }
}
