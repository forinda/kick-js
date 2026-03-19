import { Service, Inject } from '@kickjs/core'
import { USERS_REPOSITORY, type IUsersRepository } from '../../domain/repositories/users.repository'
import type { UsersResponseDTO } from '../dtos/users-response.dto'

@Service()
export class ListUsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async execute(): Promise<UsersResponseDTO[]> {
    return this.repo.findAll()
  }
}
