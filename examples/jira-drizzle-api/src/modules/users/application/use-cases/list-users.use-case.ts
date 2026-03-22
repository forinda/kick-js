import { Service, Inject } from '@forinda/kickjs-core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListUsersUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: IUserRepository) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
