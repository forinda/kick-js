import { Service, Inject } from '@kickjs/core'
import { USERS_REPOSITORY, type IUsersRepository } from '../../domain/repositories/users.repository'
import type { CreateUsersDTO } from '../dtos/create-users.dto'
import type { UsersResponseDTO } from '../dtos/users-response.dto'

@Service()
export class CreateUsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async execute(dto: CreateUsersDTO): Promise<UsersResponseDTO> {
    return this.repo.create(dto)
  }
}
