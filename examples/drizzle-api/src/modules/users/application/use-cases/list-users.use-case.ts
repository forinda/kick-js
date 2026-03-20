import { Service, Inject } from '@forinda/kickjs-core'
import { USERS_REPOSITORY, type IUsersRepository } from '../../domain/repositories/users.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListUsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
