/**
 * User Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { USER_REPOSITORY, type IUserRepository } from '../repositories/user.repository'

@Service()
export class UserDomainService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('User not found')
    }
  }
}
