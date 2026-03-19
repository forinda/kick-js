import { Service, Inject } from '@kickjs/core'
import { USERS_REPOSITORY, type IUsersRepository } from '../../domain/repositories/users.repository'
import type { UpdateUsersDTO } from '../dtos/update-users.dto'
import type { UsersResponseDTO } from '../dtos/users-response.dto'

@Service()
export class UpdateUsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async execute(id: string, dto: UpdateUsersDTO): Promise<UsersResponseDTO> {
    return this.repo.update(id, dto)
  }
}
